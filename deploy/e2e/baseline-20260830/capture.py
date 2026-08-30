#!/usr/bin/env python3
"""#61 baseline capture (pre-#56). 4 canonical pages x 2 viewports.
Real Chrome UA (GA4 bot-filter rule), domcontentloaded, full scroll,
CDP encodedDataLength for Image resources, full-page screenshots.
Outputs: /tmp/p61-baseline/<ts>/ + manifest.json (the zero-confusion anchor).
"""
import json, os, sys, time
from playwright.sync_api import sync_playwright

HOST = "46009.someofitlater.com"
BASE = f"https://{HOST}"
REAL_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
PAGES = ["/", "/services", "/work", "/work/martin-garrix"]  # garrix = gallery-class (48 imgs, same-stage)
VIEWPORTS = {"mobile390": {"width": 390, "height": 844, "deviceScaleFactor": 1},
             "desktop1448": {"width": 1448, "height": 900, "deviceScaleFactor": 1}}
OUT = sys.argv[1] if len(sys.argv) > 1 else "/tmp/p61-baseline"
os.makedirs(OUT, exist_ok=True)

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

results = {"capturedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
           "pages": PAGES, "host": HOST, "ua": REAL_UA, "viewports": VIEWPORTS,
           "runs": []}

with sync_playwright() as p:
    browser = p.chromium.launch(args=[f"--host-resolver-rules=MAP {HOST} 104.21.90.237"])
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
            page.goto(BASE + path, wait_until="domcontentloaded", timeout=45000)
            page.wait_for_timeout(1500)
            scroll_full(page)
            shot = os.path.join(OUT, f"{vp_name}_{path.strip('/').replace('/', '_') or 'home'}.png")
            page.screenshot(path=shot, full_page=True)
            total = sum(i["bytes"] for i in images)
            results["runs"].append({"page": path, "viewport": vp_name, "imageCount": len(images),
                                    "totalImageBytes": total,
                                    "non200": [i["url"] for i in images if i["status"] != 200],
                                    "images": sorted(images, key=lambda i: -i["bytes"]),
                                    "screenshot": os.path.basename(shot)})
            print(f"{vp_name:13} {path:24} imgs={len(images):3} totalImageBytes={total:>10,}")
            page.close()
        ctx.close()
    browser.close()

with open(os.path.join(OUT, "manifest.json"), "w") as f:
    json.dump(results, f, indent=1)
grand = sum(r["totalImageBytes"] for r in results["runs"] if r["viewport"] == "mobile390")
print(f"MOBILE 4-PAGE TOTAL IMAGE BYTES: {grand:,}")
print("manifest:", os.path.join(OUT, "manifest.json"))
