#!/usr/bin/env python3
"""#61 post-state byte measurement. Mirrors baseline capture.py exactly
(same 4 manifest pages, UA, scroll, CDP encodedDataLength) and ADDS the
mobile DPR=3 leg (issue pass-8 pin). Prints totals vs baseline gate."""
import json, os, sys, time
from playwright.sync_api import sync_playwright

HOST = os.environ.get("AOIN_E2E_TARGET", "46009.someofitlater.com")
BASE = f"https://{HOST}"
REAL_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
PAGES = ["/", "/services", "/work", "/work/martin-garrix"]
LEGS = {"mobile390-dpr1": (390, 844, 1), "desktop1448-dpr1": (1448, 900, 1), "mobile390-dpr3": (390, 844, 3)}
BASELINE_MOBILE_DPR1 = 106_805_981
OUT = sys.argv[1] if len(sys.argv) > 1 else "/tmp/p61-post"
os.makedirs(OUT, exist_ok=True)

def scroll_full(page):
    page.evaluate("document.body.style.scrollBehavior='auto'")
    h = page.evaluate("document.body.scrollHeight"); y = 0
    while y < h:
        y += 600
        page.mouse.wheel(0, 600); page.wait_for_timeout(220)
        h = page.evaluate("document.body.scrollHeight")
    page.mouse.wheel(0, -600); page.wait_for_timeout(1200)

results = {"capturedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
           "pages": PAGES, "host": HOST, "runs": []}
with sync_playwright() as p:
    browser = p.chromium.launch(args=[f"--host-resolver-rules=MAP {HOST} 104.21.90.237"])
    for leg, (w, h_, dpr) in LEGS.items():
        ctx = browser.new_context(user_agent=REAL_UA, viewport={"width": w, "height": h_}, device_scale_factor=dpr)
        for path in PAGES:
            page = ctx.new_page(); images, reqs = [], {}
            cdp = ctx.new_cdp_session(page); cdp.send("Network.enable")
            cdp.on("Network.responseReceived", lambda ev, reqs=reqs: reqs.update({ev["requestId"]: {"url": ev["response"]["url"], "status": ev["response"]["status"]}}) if ev.get("type") == "Image" else None)
            cdp.on("Network.loadingFinished", lambda ev, images=images, reqs=reqs: images.append({**reqs.pop(ev["requestId"], {"url": "?", "status": 0}), "bytes": ev.get("encodedDataLength", 0)}) if ev["requestId"] in reqs else None)
            page.goto(BASE + path, wait_until="domcontentloaded", timeout=45000)
            page.wait_for_timeout(1500); scroll_full(page)
            shot = os.path.join(OUT, f"{leg}_{path.strip('/').replace('/', '_') or 'home'}.png")
            page.screenshot(path=shot, full_page=True)
            total = sum(i["bytes"] for i in images)
            results["runs"].append({"page": path, "leg": leg, "imageCount": len(images),
                                    "totalImageBytes": total,
                                    "non200": [i["url"] for i in images if i["status"] != 200],
                                    "images": sorted(images, key=lambda i: -i["bytes"])})
            print(f"{leg:18} {path:24} imgs={len(images):3} totalImageBytes={total:>10,}")
            page.close()
        ctx.close()
    browser.close()
with open(os.path.join(OUT, "manifest.json"), "w") as f:
    json.dump(results, f, indent=1)
fails = 0
for leg, baseline in (("mobile390-dpr1", BASELINE_MOBILE_DPR1),):
    tot = sum(r["totalImageBytes"] for r in results["runs"] if r["leg"] == leg)
    red = 100 * (baseline - tot) / baseline
    ok = red >= 70
    fails += 0 if ok else 1
    print(f"AC1 {leg}: {tot:,} vs baseline {baseline:,} -> reduction {red:.1f}% {'PASS' if ok else 'FAIL'} (gate >=70%)")
non200 = [(r["leg"], u) for r in results["runs"] for u in r["non200"]]
print("non-200 images:", non200 if non200 else "none")
sys.exit(1 if fails or non200 else 0)
