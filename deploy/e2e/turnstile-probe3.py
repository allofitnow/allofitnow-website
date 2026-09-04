#!/usr/bin/env python3
"""Probe v3: catch the widget's OWN error code + iframe lifecycle.

Hooks turnstile.render BEFORE the site code runs (initScript) so we capture:
  - what error-callback fires (canonical code, e.g. 200500)
  - whether an iframe is ever created anywhere in the document
  - api.js network responses verbatim
"""
import json, os, time
from playwright.sync_api import sync_playwright

HOST = os.environ.get("AOIN_E2E_TARGET", "allofitnow.com")
EDGE = {"allofitnow.com": "104.21.85.13",
        "46009.someofitlater.com": "104.21.90.237"}[HOST]

INIT = """
window.__ts = {errors: [], renders: [], iframeCount: 0};
const origRender = null;
// wrap after api.js defines turnstile: poll until it exists
(function hook() {
  if (window.turnstile && window.turnstile.render) {
    const orig = window.turnstile.render;
    window.turnstile.render = function (host, opts) {
      opts = opts || {};
      window.__ts.renders.push({sitekey: opts.sitekey,
                                hasErrorCb: !!opts['error-callback'] || !!opts.errorCallback,
                                optsKeys: Object.keys(opts)});
      opts['error-callback'] = function (code) {
        window.__ts.errors.push(String(code));
        return false;
      };
      opts['expired-callback'] = function () { window.__ts.expired = true; };
      opts['timeout-callback'] = function () { window.__ts.timeout = true; };
      return orig.call(this, host, opts);
    };
  } else {
    setTimeout(hook, 40);
  }
})();
"""

with sync_playwright() as p:
    b = p.chromium.launch(args=[f"--host-resolver-rules=MAP {HOST} {EDGE}"])
    page = b.new_page(viewport={"width": 1448, "height": 900})
    page.add_init_script(INIT)
    log = []
    page.on("response", lambda r: log.append(f"{r.status} {r.url[:150]}")
            if "challenges.cloudflare.com" in r.url else None)
    page.on("requestfailed", lambda r: log.append(f"FAIL {r.url[:150]}"))
    page.on("console", lambda m: log.append(f"console.{m.type}: {m.text[:160]}")
            if m.type in ("error",) else None)

    page.goto(f"https://{HOST}/", wait_until="networkidle")
    page.wait_for_timeout(400)
    page.evaluate("document.querySelector('[data-inquiry-open]').click()")
    t0 = time.time()
    state = {}
    while time.time() - t0 < 16:
        state = page.evaluate("""() => {
          const iframes = [...document.querySelectorAll('iframe')];
          const dlg = document.querySelector('dialog.im');
          const tsHost = dlg && dlg.querySelector('.im__ts');
          return {tsErrors: window.__ts.errors, renders: window.__ts.renders,
                  totalIframes: iframes.length,
                  tsIframes: tsHost ? tsHost.querySelectorAll('iframe').length : -1,
                  iframeNames: iframes.map(f => (f.name || f.id || '').slice(0, 40)),
                  token: !!(dlg && dlg.querySelector('[name="cf-turnstile-response"]') &&
                            dlg.querySelector('[name="cf-turnstile-response"]').value)};
        }""")
        if state.get("token") or state.get("tsErrors"):
            break
        time.sleep(1.0)
    b.close()

print(json.dumps({"host": HOST, "state": state, "log": log[:25]}, indent=1)[:3200])
