#!/usr/bin/env python3
"""Neutral-page baseline: run Turnstile on CF's own browser-compat test page.

If the widget fails HERE too (same brunhild DNS wall / no iframe), the defect
is environmental or CF-side - NOT our site. If it passes, the difference is
our site/zone.
"""
import json, time
from playwright.sync_api import sync_playwright

URL = "https://browser-compat.turnstile.workers.dev/"
log, failed = [], []

with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_page(viewport={"width": 1280, "height": 900})
    page.on("response", lambda r: log.append(f"{r.status} {r.url[:130]}")
            if "challenges.cloudflare.com" in r.url else None)
    page.on("requestfailed", lambda r: (failed.append(r.url[:150]),
                                        log.append(f"FAIL {r.failure} {r.url[:130]}")))
    page.goto(URL, wait_until="domcontentloaded", timeout=30000)
    page.wait_for_timeout(2000)
    # the page auto-runs a widget; find any turnstile container and wait
    out = {}
    t0 = time.time()
    while time.time() - t0 < 25:
        out = page.evaluate("""() => {
          const ifs = [...document.querySelectorAll('iframe')];
          const tk = document.querySelector('[name=cf-turnstile-response], input[type=hidden]');
          const body = document.body.innerText.slice(0, 500);
          return {iframes: ifs.length,
                  iframeNames: ifs.map(f => (f.name||f.id||'').slice(0,50)),
                  token: !!(tk && tk.value),
                  compatOutput: body};
        }""")
        if out.get("token"):
            break
        time.sleep(1.5)
    b.close()

print(json.dumps({"url": URL, "state": out, "failed": failed,
                  "cf_net": [l for l in log if "challenges" in l][:14]}, indent=1)[:3000])
