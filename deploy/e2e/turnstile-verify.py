#!/usr/bin/env python3
"""#122 verification: Turnstile-failure fallback wiring (live site).

AC1 (blocked): challenges.cloudflare.com requests ABORTED at network layer
       (route interception) simulating a visitor whose network cannot reach
       CF challenges. Expect within ~13s of modal open:
       status text = 'VERIFICATION UNAVAILABLE - USE THE EMAIL LINK BELOW'
       and the mailto fallback link visible (href startswith mailto:).
AC3 (blocked): fill fields, click SEND -> status stays VERIFICATION
       UNAVAILABLE (not 'PLEASE FINISH THE VERIFICATION STEP').
AC2 (healthy): no interception; wait 14s; expect NO 'VERIFICATION
       UNAVAILABLE' status (widget may lack a token in automation, which is
       NOT a failure per #122).
"""
import json, os, sys, time
from playwright.sync_api import sync_playwright

HOST = os.environ.get("AOIN_E2E_TARGET", "allofitnow.com")
EDGE = {"allofitnow.com": "104.21.85.13",
        "46009.someofitlater.com": "104.21.90.237"}[HOST]
URL = f"https://{HOST}/"

fails = []
report = {"host": HOST}

def modal_state(page):
    return page.evaluate("""() => {
      const dlg = document.querySelector('dialog.im');
      const st = dlg && dlg.querySelector('[data-im-status]');
      const fb = dlg && dlg.querySelector('[data-im-fallback]');
      return {open: !!(dlg && dlg.open),
              status: st ? st.textContent.trim() : null,
              fallbackVisible: !!(fb && !fb.hidden),
              fallbackHref: fb ? fb.getAttribute('href') : null};
    }""")

def open_modal(page):
    page.goto(URL, wait_until="networkidle")
    page.wait_for_timeout(500)
    page.evaluate("document.querySelector('[data-inquiry-open]').click()")
    page.wait_for_timeout(400)

with sync_playwright() as p:
    b = p.chromium.launch(args=[f"--host-resolver-rules=MAP {HOST} {EDGE}"])

    # ---- AC1 + AC3: challenges.cloudflare.com unreachable (network abort) ----
    ctx = b.new_context()
    page = ctx.new_page()
    page.route("**challenges.cloudflare.com/**", lambda r: r.abort())
    open_modal(page)
    t0 = time.time()
    s = {}
    while time.time() - t0 < 16:
        s = modal_state(page)
        if "VERIFICATION UNAVAILABLE" in (s.get("status") or ""):
            break
        time.sleep(0.5)
    report["ac1"] = {"seconds": round(time.time() - t0, 1), **s}
    if "VERIFICATION UNAVAILABLE" not in (s.get("status") or ""):
        fails.append("AC1: fallback status never appeared")
    if not s.get("fallbackVisible") or not (s.get("fallbackHref") or "").startswith("mailto:"):
        fails.append("AC1: mailto fallback not visible")
    # AC3: fill + send
    page.fill("dialog.im [data-im-name]", "E2E Probe")
    page.fill("dialog.im [data-im-email]", "probe@allofitnow.com")
    page.fill("dialog.im textarea", "AC3 send-guard probe - ignore")
    page.click("dialog.im [data-im-send]")
    page.wait_for_timeout(600)
    s3 = modal_state(page)
    report["ac3"] = s3
    if "FINISH THE VERIFICATION" in (s3.get("status") or ""):
        fails.append("AC3: send still demands the token with widget broken")
    if "VERIFICATION UNAVAILABLE" not in (s3.get("status") or ""):
        fails.append("AC3: expected VERIFICATION UNAVAILABLE after send click")
    ctx.close()

    # ---- AC2: healthy path, no false positive ----
    page = b.new_page()
    open_modal(page)
    page.wait_for_timeout(14000)  # poll bound is 12s; anything later = bug
    s2 = modal_state(page)
    report["ac2"] = s2
    if "VERIFICATION UNAVAILABLE" in (s2.get("status") or ""):
        fails.append("AC2: false-positive tsFail on healthy (unfiltered) path")
    b.close()

report["fails"] = fails
print(json.dumps(report, indent=1))
if fails:
    print("VERIFY: FAIL")
    sys.exit(1)
print("VERIFY: PASS")
