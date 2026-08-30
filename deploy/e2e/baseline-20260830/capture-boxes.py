#!/usr/bin/env python3
"""#61 baseline LAYOUT-BOX capture (time-boxed pre-publish, like the byte
baseline): live prod still serves the pre-lane build, so these boxes anchor
the parity gate's 'identical rendered dimensions + layout boxes' clause.
Pages/UA/protocol mirror deploy/e2e/baseline-20260830/capture.py exactly.
Output: boxes.json committed beside the baseline manifest."""
import json, os, sys, time
from playwright.sync_api import sync_playwright

HOST = "46009.someofitlater.com"
BASE = f"https://{HOST}"
REAL_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
PAGES = ["/", "/services", "/work", "/work/martin-garrix"]
VIEWPORTS = {"mobile390": {"width": 390, "height": 844, "deviceScaleFactor": 1},
             "desktop1448": {"width": 1448, "height": 900, "deviceScaleFactor": 1}}
OUT = sys.argv[1] if len(sys.argv) > 1 else "/tmp/p61-boxes"
os.makedirs(OUT, exist_ok=True)

def scroll_full(page):
    page.evaluate("document.body.style.scrollBehavior='auto'")
    h = page.evaluate("document.body.scrollHeight")
    y = 0
    while y < h:
        y += 600
        page.mouse.wheel(0, 600)
        page.wait_for_timeout(220)
        h = page.evaluate("document.body.scrollHeight")
    page.mouse.wheel(0, -600)
    page.wait_for_timeout(1200)

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

results = {"capturedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
           "pages": PAGES, "host": HOST, "runs": []}
with sync_playwright() as p:
    browser = p.chromium.launch(args=[f"--host-resolver-rules=MAP {HOST} 104.21.90.237"])
    for vp_name, vp in VIEWPORTS.items():
        ctx = browser.new_context(user_agent=REAL_UA, viewport={"width": vp["width"], "height": vp["height"]},
                                  device_scale_factor=vp["deviceScaleFactor"])
        for path in PAGES:
            page = ctx.new_page()
            page.goto(BASE + path, wait_until="domcontentloaded", timeout=45000)
            page.wait_for_timeout(1500)
            scroll_full(page)
            b = page.evaluate(BOX_JS)
            results["runs"].append({"page": path, "viewport": vp_name, **b})
            print(f"{vp_name:13} {path:24} doc={b['docW']}x{b['docH']} imgs={len(b['imgs'])}")
            page.close()
        ctx.close()
    browser.close()
with open(os.path.join(OUT, "boxes.json"), "w") as f:
    json.dump(results, f, indent=1)
print("wrote", os.path.join(OUT, "boxes.json"))
