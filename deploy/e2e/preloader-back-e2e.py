#!/usr/bin/env python3
"""Preloader back-navigation E2E gate (#156).

Reproduces: load home -> preloader completes -> ClientRouter nav to /work ->
browser back (popstate / view transition) -> assert the preloader is NOT stuck
at 0% (it must either complete or be skipped/hidden, never a visible "0").

BEFORE fix: the home controller is destroyed on astro:before-swap and never
re-mounted, so the restored preloader sits visible at count 0 -> FAIL.
AFTER fix: controller re-mounts on astro:after-swap/page-load -> PASS.
"""
import json, os
from playwright.sync_api import sync_playwright

BASE = os.environ.get("AOIN_E2E_BASE", "http://192.168.30.247:8080/")

def preloader_state(page):
    return page.evaluate(
        "() => { const p = document.querySelector('[data-ref=\"preloader\"]');"
        " const c = document.querySelector('[data-ref=\"preCount\"]');"
        " if (!p) return { present: false };"
        " const cs = getComputedStyle(p);"
        " return { present: true, display: cs.display, visibility: cs.visibility,"
        " opacity: cs.opacity, count: c ? c.textContent : null }; }"
    )

def main():
    results = {}
    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(viewport={"width": 1440, "height": 900})
        page = ctx.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append("PAGEERROR: " + str(e)))
        try:
            # 1. initial load
            page.goto(BASE, wait_until="domcontentloaded")
            page.wait_for_timeout(3500)
            results["initial"] = preloader_state(page)

            # 2. ClientRouter nav to /work (synthetic click — hero .sticky overlays the nav)
            page.evaluate("""() => document.querySelector('a[href="/work"]').click()""")
            page.wait_for_timeout(2500)
            results["after_work_path"] = page.evaluate("() => location.pathname")

            # 3. browser back (popstate -> ClientRouter view transition back)
            page.go_back()
            page.wait_for_timeout(4000)

            # 4. the preloader must NOT be stuck at 0%
            after = preloader_state(page)
            results["after_back"] = after
            visible = after.get("present") and after.get("display") != "none" and after.get("visibility") != "hidden" and after.get("opacity") != "0"
            stuck = visible and after.get("count") == "0"
            results["stuck_at_0"] = stuck
            results["console_errors"] = errors[:5]
        except Exception as ex:
            results["fatal"] = str(ex)
        finally:
            ctx.close()
            browser.close()

    print(json.dumps(results, indent=1))
    ok = (not results.get("fatal")
          and results.get("after_back") is not None
          and not results.get("stuck_at_0"))
    print("PRELOADER-BACK GATE:", "PASS" if ok else "FAIL")

if __name__ == "__main__":
    main()
