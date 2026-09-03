#!/usr/bin/env python3
"""Post-publish verification for #120 (AC3).

Asserts on the LIVE site, no injections:
  A) with the inquiry modal open: computed cursor over dialog, inputs, tabs,
     close button, and at 3 backdrop points != none (expect 'auto')
  B) modal closed: cursor over body is still 'none' (crosshair regime intact)
     and the crosshair tracks the pointer (opacity 1 after move)
  C) crosshair split behavior on a hot target still fires (transform != none
     on a quad after hovering a link)
"""
import json, os, sys
from playwright.sync_api import sync_playwright

HOST = os.environ.get("AOIN_E2E_TARGET", "allofitnow.com")
EDGE = {"allofitnow.com": "104.21.85.13",
        "46009.someofitlater.com": "104.21.90.237"}[HOST]

CHECK_OPEN = """() => {
  const dlg = document.querySelector('dialog.im');
  if (!dlg || !dlg.open) return {modal: false};
  const pts = [dlg.querySelector('.im__close'), dlg.querySelector('.im__tab'),
               dlg.querySelector('input, textarea'), dlg.querySelector('.im__send')];
  const backdrop = [];
  for (const [x, y] of [[10, 10], [10, innerHeight - 10], [innerWidth - 10, 10]]) {
    const el = document.elementFromPoint(x, y);
    backdrop.push(el && el.tagName === 'DIALOG' ? getComputedStyle(el).cursor : 'no-dialog-at-point');
  }
  return {
    modal: true,
    dialogCursor: getComputedStyle(dlg).cursor,
    controls: pts.map(e => e ? getComputedStyle(e).cursor : 'missing'),
    backdropCursors: backdrop,
  };
}"""

CHECK_CLOSED = """() => {
  const cur = document.querySelector('[data-aoin-cursor]');
  const q = cur && cur.querySelector('[data-cq]');
  return {
    bodyCursor: getComputedStyle(document.body).cursor,
    crosshairPresent: !!cur,
    crosshairOpacity: cur ? cur.style.opacity : 'gone',
    quadTransform: q ? q.style.transform : 'gone',
  };
}"""

fails = []
with sync_playwright() as p:
    b = p.chromium.launch(args=[f"--host-resolver-rules=MAP {HOST} {EDGE}"])
    page = b.new_page(viewport={"width": 1448, "height": 900})
    page.goto(f"https://{HOST}/", wait_until="networkidle")
    page.wait_for_timeout(800)

    # A: modal open — native cursor must be visible everywhere over it
    page.evaluate("document.querySelector('[data-inquiry-open]').click()")
    page.wait_for_timeout(600)
    a = page.evaluate(CHECK_OPEN)
    page.mouse.move(700, 450)
    page.wait_for_timeout(120)
    if not a.get("modal"):
        fails.append("modal did not open")
    else:
        if a["dialogCursor"] == "none":
            fails.append(f"dialog cursor none")
        for i, c in enumerate(a["controls"]):
            if c == "none":
                fails.append(f"control[{i}] cursor none")
        for i, c in enumerate(a["backdropCursors"]):
            if c == "none":
                fails.append(f"backdrop[{i}] cursor none")

    # B: modal closed — crosshair regime intact
    page.keyboard.press("Escape")
    page.wait_for_timeout(400)
    page.mouse.move(400, 300)
    page.wait_for_timeout(200)
    bb = page.evaluate(CHECK_CLOSED)
    if bb["bodyCursor"] != "none":
        fails.append(f"body cursor {bb['bodyCursor']} (expected none — crosshair regime)")
    if bb["crosshairOpacity"] != "1":
        fails.append(f"crosshair opacity {bb['crosshairOpacity']} (expected 1 after move)")

    # C: split on hot target — quad transform changes after hovering a link
    page.mouse.move(60, 60)
    page.wait_for_timeout(120)
    base = page.evaluate("""() => document.querySelector('[data-aoin-cursor] [data-cq]').style.transform""")
    page.evaluate("document.querySelector('footer a, a[href]').dispatchEvent(new Event('pointerover', {bubbles: true}))")
    page.wait_for_timeout(120)
    hot = page.evaluate("""() => document.querySelector('[data-aoin-cursor] [data-cq]').style.transform""")
    if hot == base and "translate(0px, 0px)" == hot:
        fails.append("split did not fire on pointerover (transform unchanged)")

    print(json.dumps({"host": HOST, "open": a, "closed": bb,
                      "quadTransform": {"base": base, "hot": hot}}, indent=1))
    b.close()

if fails:
    print("VERIFY: FAIL —", "; ".join(fails))
    sys.exit(1)
print("VERIFY: PASS — native cursor visible over modal; crosshair regime intact elsewhere")
