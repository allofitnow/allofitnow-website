#!/usr/bin/env python3
"""#125 UI verification: attachment upload on the live contact modal.

AC3 (UI): + ATTACH FILES button visible, SECURE microcopy present, file
picker wired (set_input_files -> chip with name + MB), chip remove works,
JSON-path form still fills. (Full send needs a human Turnstile solve —
out of automated scope by CF design; transport proven via live e2e POST.)
"""
import json, os, sys, tempfile, time
from playwright.sync_api import sync_playwright

HOST = os.environ.get("AOIN_E2E_TARGET", "allofitnow.com")
EDGE = {"allofitnow.com": "104.21.85.13",
        "46009.someofitlater.com": "104.21.90.237"}[HOST]

fails = []
with sync_playwright() as p:
    b = p.chromium.launch(args=[f"--host-resolver-rules=MAP {HOST} {EDGE}"])
    page = b.new_page()
    page.goto(f"https://{HOST}/", wait_until="networkidle")
    page.wait_for_timeout(400)
    page.evaluate("document.querySelector('[data-inquiry-open]').click()")
    page.wait_for_timeout(400)

    attach = page.locator("dialog.im [data-im-attach]")
    secure = page.locator("dialog.im .im__secure")
    fin = page.locator("dialog.im [data-im-file]")
    if not attach.is_visible(): fails.append("attach button not visible")
    if "SECURE" not in (secure.inner_text() if secure.count() else ""):
        fails.append("SECURE microcopy missing")
    if not fin.count(): fails.append("file input missing")

    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as f:
        f.write(b"%PDF-1.4 ui probe attachment\n"); pdf = f.name
    fin.set_input_files(pdf)
    page.wait_for_timeout(300)
    chips = page.locator("dialog.im .im__chip")
    if chips.count() != 1: fails.append(f"chip count {chips.count()} != 1")
    else:
        txt = chips.first.inner_text()
        if os.path.basename(pdf).upper() not in txt.upper(): fails.append(f"chip text lacks name: {txt}")
        if "MB" not in txt: fails.append(f"chip text lacks size: {txt}")
        page.locator("dialog.im .im__chip-x").first.click()
        page.wait_for_timeout(200)
        if page.locator("dialog.im .im__chip").count() != 0: fails.append("chip remove failed")

    # bad ext rejected client-side
    with tempfile.NamedTemporaryFile(suffix=".exe", delete=False) as f:
        f.write(b"MZ"); exe = f.name
    fin.set_input_files(exe)
    page.wait_for_timeout(200)
    if page.locator("dialog.im .im__chip").count() != 0: fails.append("exe produced a chip")
    st = page.locator("dialog.im [data-im-status]").inner_text()
    if "UNSUPPORTED" not in st: fails.append(f"no UNSUPPORTED status: {st!r}")

    # JSON-path form still functional
    page.fill("dialog.im [data-im-name]", "E2E Probe")
    page.fill("dialog.im [data-im-email]", "probe@allofitnow.com")
    page.fill("dialog.im textarea", "UI probe - ignore")
    b.close()

print(json.dumps({"host": HOST, "fails": fails}, indent=1))
print("VERIFY:", "PASS" if not fails else "FAIL")
sys.exit(1 if fails else 0)
