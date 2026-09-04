#!/usr/bin/env python3
"""Probe: Turnstile widget behavior in the inquiry modal (live prod).

Opens the modal exactly like a user, then observes:
  - api.js script load (request + status)
  - window.turnstile availability + render
  - widget iframe presence + dimensions
  - console errors / warnings
  - all challenges.cloudflare.com requests and their statuses
  - final widget state after 12s settle
"""
import json, os
from playwright.sync_api import sync_playwright

HOST = os.environ.get("AOIN_E2E_TARGET", "allofitnow.com")
EDGE = {"allofitnow.com": "104.21.85.13",
        "46009.someofitlater.com": "104.21.90.237"}[HOST]

events = {"console": [], "net": [], "pageerror": []}

with sync_playwright() as p:
    b = p.chromium.launch(args=[f"--host-resolver-rules=MAP {HOST} {EDGE}"])
    page = b.new_page(viewport={"width": 1448, "height": 900})
    page.on("console", lambda m: events["console"].append(f"{m.type}: {m.text[:220]}"))
    page.on("pageerror", lambda e: events["pageerror"].append(str(e)[:220]))
    page.on("response", lambda r: events["net"].append(
        f"{r.status} {r.request.method} {r.url[:160]}")
        if "challenges.cloudflare.com" in r.url or r.status >= 400 else None)
    page.on("requestfailed", lambda r: events["net"].append(
        f"FAILED {r.failure} {r.url[:160]}"))

    page.goto(f"https://{HOST}/", wait_until="networkidle")
    page.wait_for_timeout(600)
    page.evaluate("document.querySelector('[data-inquiry-open]').click()")
    page.wait_for_timeout(12000)  # let api.js + widget settle

    state = page.evaluate("""() => {
      const dlg = document.querySelector('dialog.im');
      const tsHost = dlg && dlg.querySelector('.im__ts, [data-turnstile], .im__turnstile');
      const ifr = tsHost ? tsHost.querySelector('iframe') : null;
      const respInput = dlg ? dlg.querySelector('[name="cf-turnstile-response"]') : null;
      return {
        modalOpen: !!(dlg && dlg.open),
        tsHostFound: !!tsHost,
        tsHostClass: tsHost ? tsHost.className : null,
        iframePresent: !!ifr,
        iframeSrc: ifr ? ifr.src.slice(0, 140) : null,
        iframeSize: ifr ? [ifr.clientWidth, ifr.clientHeight] : null,
        responseTokenPresent: !!(respInput && respInput.value),
        tsApiLoaded: !!(window.turnstile && window.turnstile.render),
        scriptTags: [...document.querySelectorAll('script[src*=challenges]')].map(s => s.src.slice(0, 120)),
      };
    }""")
    b.close()

print(json.dumps({"host": HOST, "state": state, "events": events}, indent=1)[:4000])
