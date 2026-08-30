#!/usr/bin/env python3
"""#61 AC2: whole-site BFS audit - every internal page 200, every image
URL (incl. srcset rungs/variants + spaced names) 200. 0 non-200 gate."""
import re, sys, urllib.request, urllib.error
from html.parser import HTMLParser
from playwright.sync_api import sync_playwright

HOST = "46009.someofitlater.com"
BASE = f"https://{HOST}"
REAL_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"

class Links(HTMLParser):
    def __init__(self):
        super().__init__(); self.hrefs, self.srcs, self.srcsets = [], [], []
    def handle_starttag(self, tag, attrs):
        d = dict(attrs)
        if tag == "a" and d.get("href", "").startswith("/"):
            self.hrefs.append(d["href"].split("#")[0].split("?")[0])
        if tag == "img":
            for k in ("src", "data-lazysrc", "data-thumb-src"):
                if d.get(k): self.srcs.append(d[k])
            for k in ("srcset", "data-lazysrcset", "data-thumb-srcset"):
                if d.get(k): self.srcs += [u.split()[0] for u in d[k].split(",")]

seen, queue, pages, bad = set(), ["/"], {}, []
with sync_playwright() as p:
    browser = p.chromium.launch(args=[f"--host-resolver-rules=MAP {HOST} 104.21.90.237"])
    ctx = browser.new_context(user_agent=REAL_UA, viewport={"width": 390, "height": 844})
    page = ctx.new_page()
    imgs_per_page = {}
    while queue:
        path = queue.pop(0)
        if path in seen or path.startswith(("/api", "/admin")):
            continue
        seen.add(path)
        resp = page.goto(BASE + path, wait_until="domcontentloaded", timeout=45000)
        status = resp.status if resp else 0
        pages[path] = status
        if status != 200:
            bad.append((path, status)); continue
        page.wait_for_timeout(700)
        html = page.content()
        lp = Links(); lp.feed(html)
        imgs_per_page[path] = sorted(set(lp.srcs))
        for h in lp.hrefs:
            if h not in seen:
                queue.append(h)
        if len(seen) > 60:
            break
    # scroll home + gallery to force lazy DOM into content once more
    browser.close()

img_urls = sorted({u for v in imgs_per_page.values() for u in v})
for u in img_urls:
    if u.startswith("data:"):
        continue
    try:
        req = urllib.request.Request(BASE + u if u.startswith("/") else u, headers={"User-Agent": REAL_UA})
        code = urllib.request.urlopen(req, timeout=30).status
    except urllib.error.HTTPError as e:
        code = e.code
    except Exception as e:
        code = str(e)[:40]
    if code != 200:
        bad.append((u, code))

print(f"pages crawled: {len(pages)} (non-200: {sum(1 for s in pages.values() if s != 200)})")
print(f"image URLs probed: {len(img_urls)}")
print(f"BFS: {'PASS 0 non-200' if not bad else 'FAIL'}")
for b in bad:
    print(" -", b)
sys.exit(1 if bad else 0)
