#!/usr/bin/env python3
"""Cursor-over-modal visual probe — .246 merge-preview (b3385b7).

Verifies designer a9d889c reseat + our #120-rule removal work together:
 1. crosshair element IS a descendant of dialog[open] when the modal is open
 2. computed cursor over modal children = none (no double cursor after
    dropping the #120 cursor:auto rule)
 3. crosshair transform tracks mouse position over the modal
 4. close -> crosshair re-seated in <body>
 5. modal UI intact (form fields + attach button present)
Exit 0 = all pass. Any FAIL exits 1 with details.
"""
import re
import sys
from playwright.sync_api import sync_playwright

URL = "http://192.168.30.246:4321/"
results = []


def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"  [{detail}]" if detail else ""))


with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1440, "height": 900})
    page.goto(URL, wait_until="networkidle")

    # /work: plain nav (homepage sticky layer intercepts the nav CONTACT click)
    page.goto(URL + "work/", wait_until="networkidle")
    cur = page.locator(".aoin-cursor")
    check("crosshair element exists", cur.count() == 1)
    seat0 = page.evaluate(
        "() => { const c = document.querySelector('.aoin-cursor');"
        " const dlg = c && c.closest('dialog'); return dlg ? 'dialog' : 'body'; }"
    )
    check("initially seated outside dialog", seat0 == "body", seat0)

    # Wake the crosshair (opacity 0 until first pointer move)
    page.mouse.move(700, 400)
    page.wait_for_timeout(300)
    op = page.evaluate(
        "() => +getComputedStyle(document.querySelector('.aoin-cursor')).opacity"
    )
    check("crosshair visible after mousemove (opacity>0.5)", op > 0.5, f"opacity={op}")

    # Open the contact modal via any trigger
    page.locator("[data-inquiry-open]").first.click()
    page.wait_for_timeout(500)
    check("dialog[open] present after trigger", page.locator("dialog[open]").count() == 1)

    seat1 = page.evaluate(
        "() => { const c = document.querySelector('.aoin-cursor');"
        " const dlg = document.querySelector('dialog[open]');"
        " return dlg && dlg.contains(c) ? 'dialog' : (c ? c.parentElement.tagName : 'gone'); }"
    )
    check("crosshair re-seated INTO dialog", seat1 == "dialog", seat1)

    # No double cursor: computed cursor over modal input still 'none'
    page.mouse.move(720, 420)
    page.wait_for_timeout(200)
    cursor_style = page.evaluate(
        "() => getComputedStyle(document.querySelector('dialog[open] input')).cursor"
    )
    check("computed cursor over modal input = none", cursor_style == "none", cursor_style)

    # Tracking: move over modal, transform should carry the coords
    page.mouse.move(720, 450)
    page.wait_for_timeout(200)
    tr = page.evaluate(
        "() => { const q = document.querySelector('dialog[open] .aoin-cursor');"
        " return q ? getComputedStyle(q).transform : 'none'; }"
    )
    m = re.search(r"matrix\(([-\d.e]+),\s*([-\d.e]+),\s*([-\d.e]+),\s*([-\d.e]+),\s*([-\d.]+),\s*([-\d.]+)\)", tr or "")
    ok_track = bool(m) and abs(float(m.group(5)) - 720) < 4 and abs(float(m.group(6)) - 450) < 4
    check("crosshair tracks mouse over modal", ok_track, tr)

    # Modal UI intact (email stack untouched by merge)
    dlg = page.locator("dialog[open]")
    n_input = dlg.locator("input:visible, textarea:visible").count()
    check("modal form fields visible", n_input >= 2, f"{n_input} fields")
    check("attach button present", dlg.locator("[data-im-attach]").count() == 1)

    # Close -> cursor returns to body
    page.keyboard.press("Escape")
    page.wait_for_timeout(500)
    seat2 = page.evaluate(
        "() => { const c = document.querySelector('.aoin-cursor');"
        " return c && !c.closest('dialog') ? 'body' : 'dialog/other'; }"
    )
    check("close returns crosshair to body", seat2 == "body", seat2)

    browser.close()

fails = [r for r in results if not r[1]]
print(f"\n{len(results) - len(fails)}/{len(results)} pass")
if fails:
    print("VERIFY: FAIL")
    sys.exit(1)
print("VERIFY: PASS")
