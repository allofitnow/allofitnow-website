#!/usr/bin/env python3
"""#61/#58 AC3 root-cause probe: garrix +378px doc height.
Loads live page twice: (a) clean new build, (b) main document fulfilled
from the pre-cutover archive HTML (assets still resolve from R2 - tombstones=0).
Collects doc height + rects of every element with a bounding box; diffs them.
"""
import json
from playwright.sync_api import sync_playwright

HOST = "46009.someofitlater.com"
URL = f"https://{HOST}/work/martin-garrix"
REAL_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
OLD_HTML = open("/tmp/mg-old.html").read()

JS = """
() => {
  const out = { docH: document.body.scrollHeight, els: [] };
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    const absY = r.top + window.scrollY;
    out.els.push({
      tag: el.tagName.toLowerCase(),
      cls: (el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className || '').toString().slice(0, 60),
      y: Math.round(absY), h: Math.round(r.height), w: Math.round(r.width)
    });
  }
  out.els.sort((a, b) => a.y - b.y);
  return out;
}
"""

def capture(page, fulfill_old=False):
    if fulfill_old:
        page.route(URL + "*", lambda route: route.fulfill(content_type="text/html", body=OLD_HTML)
                   if route.request.url.rstrip("/") == URL else route.continue_())
        # also catch trailing-slash variant
        page.route(URL + "/", lambda route: route.fulfill(content_type="text/html", body=OLD_HTML))
    page.goto(URL, wait_until="domcontentloaded", timeout=45000)
    page.wait_for_timeout(2500)
    # scroll through to settle lazy content, then back to top
    h = page.evaluate("document.body.scrollHeight"); y = 0
    while y < h:
        y += 600; page.mouse.wheel(0, 600); page.wait_for_timeout(150)
        h = page.evaluate("document.body.scrollHeight")
    page.mouse.wheel(0, -6000); page.wait_for_timeout(800)
    return page.evaluate(JS)

with sync_playwright() as p:
    browser = p.chromium.launch(args=[f"--host-resolver-rules=MAP {HOST} 104.21.90.237"])
    ctx = browser.new_context(user_agent=REAL_UA, viewport={"width": 390, "height": 844}, device_scale_factor=1)
    new = capture(ctx.new_page(), fulfill_old=False)
    old = capture(ctx.new_page(), fulfill_old=True)
    ctx.close(); browser.close()

print("old docH:", old["docH"], " new docH:", new["docH"], " delta:", new["docH"] - old["docH"])
print("old els:", len(old["els"]), " new els:", len(new["els"]))

# align by (tag, cls) sequence: find elements present in both whose y diverges,
# and elements only in one build. Compare cumulative heights of siblings.
def key(e): return (e["tag"], e["cls"], e["w"])

# greedy walk: match by key+order
oi, ni = 0, 0
diverged = False
import collections
oldq = list(old["els"]); newq = list(new["els"])
report = []
# simpler: bucket by key and sum heights
os = collections.defaultdict(lambda: [0, 0]); ns = collections.defaultdict(lambda: [0, 0])
for e in oldq: k = key(e); os[k][0] += 1; os[k][1] += e["h"]
for e in newq: k = key(e); ns[k][0] += 1; ns[k][1] += e["h"]
allk = set(os) | set(ns)
rows = []
for k in allk:
    o, n = os.get(k, [0, 0]), ns.get(k, [0, 0])
    if o[1] != n[1] or o[0] != n[0]:
        rows.append((abs(n[1] - o[1]), k, o, n))
rows.sort(reverse=True)
print("\n== element groups with height/count changes (top 15) ==")
for d, k, o, n in rows[:15]:
    print(f"{k[0]}.{k[1][:48]:48} w={k[2]:4}  old n={o[0]:3} sumH={o[1]:6}  new n={n[0]:3} sumH={n[1]:6}  dH={n[1]-o[1]:+5}")
json.dump({"old": old, "new": new}, open("/tmp/mg-rects.json", "w"))
print("\nwrote /tmp/mg-rects.json")
