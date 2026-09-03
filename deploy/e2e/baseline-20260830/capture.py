#!/usr/bin/env python3
"""#61 baseline capture (pre-#56). 4 canonical pages x 2 viewports.
Real Chrome UA (GA4 bot-filter rule), domcontentloaded, full scroll,
CDP encodedDataLength for Image resources, full-page screenshots.
Outputs: /tmp/p61-baseline/<ts>/ + manifest.json (the zero-confusion anchor).
"""
import json, os, sys, time
from playwright.sync_api import sync_playwright

HOST = os.environ.get("AOIN_E2E_TARGET", "46009.someofitlater.com")
BASE = f"https://{HOST}"
# per-host pinned edge (stale local resolver must never poison a capture)
EDGE = {"46009.someofitlater.com": "104.21.90.237",
        "allofitnow.com": "104.21.85.13"}[HOST]
REAL_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
PAGES = ["/", "/services", "/work", "/work/martin-garrix"]  # garrix = gallery-class (48 imgs, same-stage)
VIEWPORTS = {"mobile390": {"width": 390, "height": 844, "deviceScaleFactor": 1},
             "desktop1448": {"width": 1448, "height": 900, "deviceScaleFactor": 1}}
OUT = sys.argv[1] if len(sys.argv) > 1 else "/tmp/p61-baseline"
os.makedirs(OUT, exist_ok=True)

FREEZE_JS = """(() => {
  const s = document.createElement('style');
  s.textContent = '* { animation-play-state: paused !important; transition: none !important; }';
  document.addEventListener('DOMContentLoaded', () => document.head && document.head.append(s));
})();"""

BOX_JS = """() => {
  const imgs = [...document.querySelectorAll('img')].map(i => {
    const r = i.getBoundingClientRect();
    const abs = { x: r.x + scrollX, y: r.y + scrollY, w: r.width, h: r.height };
    return { src: (i.currentSrc || i.src || '').split('/').pop().slice(0, 90),
             box: [Math.round(abs.x), Math.round(abs.y), Math.round(abs.w), Math.round(abs.h)] };
  });
  return { docW: document.documentElement.scrollWidth,
           docH: document.documentElement.scrollHeight,
           imgs };
}"""

def settle(page):
    """Block on every img decode + font load so layout is final before
    measuring. Hard-bounded (JS race): off-canvas lazy marquee clones are
    never fetched, so onload never fires and an unbounded await would hang
    the whole stage (run-6 post-bytes 900s TIMEOUT)."""
    try:
        page.evaluate("""async () => {
          const t = (p, ms) => Promise.race([p, new Promise(r => setTimeout(r, ms))]);
          const imgs = [...document.images];
          await t(Promise.all(imgs.map(i => i.complete ? Promise.resolve()
              : new Promise(r => { i.onload = i.onerror = r; }))), 8000);
          if (document.fonts && document.fonts.ready) await t(document.fonts.ready, 3000);
        }""")
    except Exception:
        pass

def freeze_runtime(page):
    """Deterministic phase for JS (rAF-driven) motion: CSS animation-play-state
    cannot pause a requestAnimationFrame marquee -- each capture would freeze
    at a random translate phase (run-6: same img row at x=8k..13k / negative x
    across loads). Stop new frames and reset inline transforms -> phase 0 in
    every lane."""
    try:
        page.evaluate("""() => {
          window.requestAnimationFrame = () => 0;
          for (const el of document.querySelectorAll('*')) {
            const t = el.style.transform;
            if (t && /translate|matrix|perspective|scale|rotate/i.test(t)) el.style.transform = 'none';
          }
        }""")
    except Exception:
        pass

def scroll_full(page):
    page.evaluate("document.body.style.scrollBehavior='auto'")
    h = page.evaluate("document.body.scrollHeight")
    y = 0
    while y < h:
        y += 600
        page.mouse.wheel(0, 600)
        page.wait_for_timeout(220)
        h = page.evaluate("document.body.scrollHeight")  # lazy growth
    page.mouse.wheel(0, -600)  # settle trigger for late listeners
    page.wait_for_timeout(1200)
    settle(page)
    freeze_runtime(page)
    page.wait_for_timeout(150)  # one frame for layout to reflect the reset

results = {"capturedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
           "pages": PAGES, "host": HOST, "ua": REAL_UA, "viewports": VIEWPORTS,
           "runs": []}

with sync_playwright() as p:
    browser = p.chromium.launch(args=[f"--host-resolver-rules=MAP {HOST} {EDGE}"])
    for vp_name, vp in VIEWPORTS.items():
        ctx = browser.new_context(user_agent=REAL_UA, viewport={"width": vp["width"], "height": vp["height"]},
                                  device_scale_factor=vp["deviceScaleFactor"])
        for path in PAGES:
            page = ctx.new_page()
            images, reqs = [], {}
            cdp = ctx.new_cdp_session(page)
            cdp.send("Network.enable")
            def on_response(ev, reqs=reqs):
                if ev.get("type") == "Image":
                    reqs[ev["requestId"]] = {"url": ev["response"]["url"], "status": ev["response"]["status"]}
            def on_finished(ev, images=images, reqs=reqs):
                meta = reqs.pop(ev["requestId"], None)
                if meta:
                    meta["bytes"] = ev.get("encodedDataLength", 0)
                    images.append(meta)
            cdp.on("Network.responseReceived", on_response)
            cdp.on("Network.loadingFinished", on_finished)
            page.add_init_script(FREEZE_JS)  # registered before goto -> injected on THIS navigation
            page.goto(BASE + path, wait_until="domcontentloaded", timeout=45000)
            page.wait_for_timeout(1500)
            scroll_full(page)
            b = page.evaluate(BOX_JS)
            shot = os.path.join(OUT, f"{vp_name}_{path.strip('/').replace('/', '_') or 'home'}.png")
            page.screenshot(path=shot, full_page=True)
            total = sum(i["bytes"] for i in images)
            results["runs"].append({"page": path, "viewport": vp_name, "imageCount": len(images),
                                    "totalImageBytes": total,
                                    "non200": [i["url"] for i in images if i["status"] != 200],
                                    "images": sorted(images, key=lambda i: -i["bytes"]),
                                    "screenshot": os.path.basename(shot),
                                    "imgs": b["imgs"], "docW": b["docW"], "docH": b["docH"]})
            print(f"{vp_name:13} {path:24} imgs={len(images):3} totalImageBytes={total:>10,}")
            page.close()
        ctx.close()
    browser.close()

with open(os.path.join(OUT, "manifest.json"), "w") as f:
    json.dump(results, f, indent=1)
# boxes.json (parity.py input shape) from the same settled DOM the PNG came from
with open(os.path.join(OUT, "boxes.json"), "w") as f:
    json.dump({"capturedAt": results["capturedAt"], "pages": PAGES, "host": HOST, "runs": results["runs"]}, f, indent=1)
grand = sum(r["totalImageBytes"] for r in results["runs"] if r["viewport"] == "mobile390")
print(f"MOBILE 4-PAGE TOTAL IMAGE BYTES: {grand:,}")
print("manifest:", os.path.join(OUT, "manifest.json"))
print("boxes:", os.path.join(OUT, "boxes.json"))
