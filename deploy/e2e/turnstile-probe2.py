#!/usr/bin/env python3
"""Probe v2: Turnstile orchestration DNS, resolved IN-FLIGHT.

While the widget challenge runs, immediately DoH-resolve (via cloudflare-dns.com,
bypassing local resolvers) every challenges.cloudflare.com hostname the page
touches. Also retries the widget once after failure, and re-DoH's the failed
host at the end to see if the record was torn down.
"""
import json, os, time, urllib.request
from playwright.sync_api import sync_playwright

HOST = os.environ.get("AOIN_E2E_TARGET", "allofitnow.com")
EDGE = {"allofitnow.com": "104.21.85.13",
        "46009.someofitlater.com": "104.21.90.237"}[HOST]

def doh(name):
    try:
        u = f"https://cloudflare-dns.com/dns-query?name={name}&type=A"
        with urllib.request.urlopen(urllib.request.Request(
                u, headers={"accept": "application/dns-json"}), timeout=6) as r:
            d = json.loads(r.read())
        ans = [f"{a.get('type')} {a.get('data')}" for a in d.get("Answer", [])]
        return {"status": d.get("Status"), "answer": ans[:3]}
    except Exception as e:
        return {"error": str(e)[:120]}

failed_hosts, seen_hosts = [], []
doh_results = {}

with sync_playwright() as p:
    b = p.chromium.launch(args=[f"--host-resolver-rules=MAP {HOST} {EDGE}"])
    page = b.new_page(viewport={"width": 1448, "height": 900})
    log = []
    page.on("requestfailed", lambda r: (
        failed_hosts.append(r.url.split("/")[2]),
        log.append(f"FAILED {r.failure} {r.url[:150]}")))
    page.on("request", lambda r: seen_hosts.append(r.url.split("/")[2])
            if "challenges.cloudflare.com" in r.url else None)

    page.goto(f"https://{HOST}/", wait_until="networkidle")
    page.wait_for_timeout(400)
    page.evaluate("document.querySelector('[data-inquiry-open]').click()")

    # watch in-flight for 14s; DoH-resolve each new challenges host ONCE, live
    t0 = time.time()
    while time.time() - t0 < 14:
        for h in set(seen_hosts) - set(doh_results):
            doh_results[h] = doh(h)
        time.sleep(1.2)
    state = page.evaluate("""() => {
      const dlg = document.querySelector('dialog.im');
      const tsHost = dlg && dlg.querySelector('.im__ts');
      const ifr = tsHost && tsHost.querySelector('iframe');
      const resp = dlg && dlg.querySelector('[name="cf-turnstile-response"]');
      return {iframe: !!ifr, iframeH: ifr ? ifr.clientHeight : 0,
              token: !!(resp && resp.value),
              tsApi: !!(window.turnstile && window.turnstile.render)};
    }""")
    # retry render once (fresh widget id) to test transient-vs-sticky
    retried = page.evaluate("""() => {
      try {
        const dlg = document.querySelector('dialog.im');
        const host = dlg.querySelector('.im__ts');
        const w = window;
        if (w.turnstile && w.turnstile.render) {
          w.__retryId = w.turnstile.render(host, {sitekey: '0x4AAAAAAElaykmuLNTNiyqY'});
          return 'rendered';
        }
        return 'no-api';
      } catch (e) { return 'err:' + e; }
    }""")
    page.wait_for_timeout(6000)
    state2 = page.evaluate("""() => {
      const dlg = document.querySelector('dialog.im');
      const tsHost = dlg && dlg.querySelector('.im__ts');
      const ifr = tsHost && tsHost.querySelector('iframe');
      const resp = dlg && dlg.querySelector('[name="cf-turnstile-response"]');
      return {iframe: !!ifr, iframeH: ifr ? ifr.clientHeight : 0,
              token: !!(resp && resp.value)};
    }""")
    b.close()

# after session: are the failed hosts still unresolvable?
post = {h: doh(h) for h in set(failed_hosts)}

print(json.dumps({
    "host": HOST, "state_t14": state, "retry": retried, "state_post_retry": state2,
    "doh_inflight": doh_results, "failed_hosts": failed_hosts,
    "doh_after_session": post, "log": log[:12],
}, indent=1)[:3500])
