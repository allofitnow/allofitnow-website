#!/usr/bin/env python3
"""Probe: cursor visibility over the InquiryModal (top-layer occlusion).

Root-cause check + fix validation in one browser session:
  A) computed cursor over dialog/input with modal open (expect 'none' pre-fix)
  B) is the crosshair (.aoin-cursor) occluded? (elementFromPoint at its center)
  C) inject candidate fix `dialog[open], dialog[open] * {cursor:auto !important}`
     and re-read computed cursor (expect 'auto')
"""
import json, os, sys
from playwright.sync_api import sync_playwright

HOST = os.environ.get("AOIN_E2E_TARGET", "allofitnow.com")
EDGE = {"allofitnow.com": "104.21.85.13",
        "46009.someofitlater.com": "104.21.90.237"}[HOST]

PROBE_JS = """() => {
  const dlg = document.querySelector('dialog.im');
  const inp = dlg && dlg.querySelector('input, textarea');
  const cur = document.querySelector('[data-aoin-cursor]');
  const r = cur && cur.getBoundingClientRect();
  let occ = null;
  if (r) {
    const el = document.elementFromPoint(
      Math.min(Math.max(r.x + 1, 1), innerWidth - 1),
      Math.min(Math.max(r.y + 1, 1), innerHeight - 1));
    occ = el ? (el === cur ? 'crosshair-top' : el.tagName + '.' + (el.className || '').toString().slice(0, 30)) : 'none';
  }
  return {
    dialogOpen: !!(dlg && dlg.open),
    dialogCursor: dlg ? getComputedStyle(dlg).cursor : 'no-dialog',
    inputCursor: inp ? getComputedStyle(inp).cursor : 'no-input',
    crosshairOpacity: cur ? cur.style.opacity : 'no-crosshair',
    crosshairOccluder: occ,
  };
}"""

FIX_CSS = "dialog[open], dialog[open] * { cursor: auto !important; }"

with sync_playwright() as p:
    b = p.chromium.launch(args=[f"--host-resolver-rules=MAP {HOST} {EDGE}"])
    page = b.new_page(viewport={"width": 1448, "height": 900})
    page.goto(f"https://{HOST}/", wait_until="networkidle")
    page.wait_for_timeout(800)

    # open via JS dispatch — the header CONTACT <a> is pointer-intercepted by
    # the sticky strip in this frozen-scroll probe context (site behavior, not
    # the bug under test)
    page.evaluate("document.querySelector('[data-inquiry-open]').click()")
    page.wait_for_timeout(600)
    pre = page.evaluate(PROBE_JS)

    page.add_style_tag(content=FIX_CSS)
    page.wait_for_timeout(100)
    post = page.evaluate(PROBE_JS)

    # move pointer over the open modal body to confirm crosshair tracks there
    page.mouse.move(700, 450)
    page.wait_for_timeout(150)
    moved = page.evaluate(PROBE_JS)

    print(json.dumps({"host": HOST, "pre": pre, "fix_injected": post, "after_move": moved}, indent=1))
    b.close()
