#!/usr/bin/env python3
"""#126 probe: debug alert() submit on non-live hosts (.246 preview).

AC1: valid fields + SEND -> alert() debug dialog, NO /api/contact fetch,
     positive status, fields reset
AC3: empty fields -> field prompt error, no alert
AC4: alert copy is unmistakably debug
(AC2 live-identity is structural: the gate is a hostname check placed
 before the Turnstile branch; live hosts never enter it.)
"""
import sys
from playwright.sync_api import sync_playwright

URL = "http://192.168.30.246:4321/work/"
results = []


def check(name, ok, detail=""):
    results.append((name, ok))
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"  [{detail}]" if detail else ""))


with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1440, "height": 900})

    api_hits = []
    page.on("request", lambda r: api_hits.append(r.url) if "/api/contact" in r.url else None)

    alerts = []
    page.on("dialog", lambda d: (alerts.append(d.message), d.accept()))

    page.goto(URL, wait_until="networkidle")
    page.locator("[data-inquiry-open]").first.click()
    page.wait_for_timeout(400)
    dlg = page.locator("dialog[open]")

    # AC3 first: empty fields -> prompt, no alert
    dlg.locator("[data-im-send]").click()
    page.wait_for_timeout(300)
    status = dlg.locator("[data-im-status]").text_content() if dlg.locator("[data-im-status]").count() else ""
    if not status:
        # status element may live elsewhere in the dialog
        status = page.evaluate("() => { const el = document.querySelector('dialog[open] [class*=status], dialog[open] [data-im-status]'); return el ? el.textContent : ''; }")
    check("AC3 empty fields -> prompt, no alert", "FILL" in (status or "").upper() and not alerts, status.strip())

    # Fill the form
    dlg.locator("[data-im-name]").fill("Preview Tester")
    dlg.locator("[data-im-email]").fill("tester@example.com")
    dlg.locator("[data-im-message]").fill("Hello from the merge preview probe.")
    page.wait_for_timeout(200)

    # AC1: SEND -> alert, no fetch, reset
    dlg.locator("[data-im-send]").click()
    page.wait_for_timeout(600)

    check("AC1 alert() shown", len(alerts) == 1, alerts[0][:60] + "..." if alerts else "none")
    check("AC1 no /api/contact request", len(api_hits) == 0, str(api_hits))
    msg = alerts[0] if alerts else ""
    check("AC4 copy is clearly debug", "DEBUG" in msg and "NOTHING WAS SENT" in msg and "would have been submitted" in msg.lower(), msg.splitlines()[0] if msg else "none")
    check("AC1 summary carries fields", "Preview Tester" in msg and "tester@example.com" in msg and "GENERAL" in msg.upper(), "")

    name_after = page.evaluate("() => document.querySelector('dialog[open] [data-im-name]').value")
    check("AC1 fields reset after debug send", name_after == "", repr(name_after))

    browser.close()

fails = [r for r in results if not r[1]]
print(f"\n{len(results) - len(fails)}/{len(results)} pass")
sys.exit(1 if fails else 0)
