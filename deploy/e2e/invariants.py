#!/usr/bin/env python3
"""#61 AC4 invariants:
(1) no /cdn-cgi/ image URLs in served HTML of the 4 canonical pages;
(2) worker version stamp: every sampled asset fetch equals the CURRENTLY
    deployed stamp (read live from /, assert equality - no frozen string);
(3) optional: publish manifest verify green (shells out to lib/manifest.py
    verify --manifest <path>, run on the box holding the manifest).
Usage: invariants.py [manifest.json]"""
import subprocess, sys, urllib.request

HOST = "46009.someofitlater.com"
BASE = f"https://{HOST}"
REAL_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
PAGES = ["/", "/services", "/work", "/work/martin-garrix"]
fails = []

def get(url, head=False):
    req = urllib.request.Request(url, headers={"User-Agent": REAL_UA}, method="HEAD" if head else "GET")
    r = urllib.request.urlopen(req, timeout=30)
    return r.status, dict(r.headers), (b"" if head else r.read())

# live stamp = ground truth (retired frozen-string check, pass-8)
_, h0, _ = get(BASE + "/", head=True)
live = h0.get("x-46009-worker")
print("live worker stamp:", live)
if not live:
    fails.append("no x-46009-worker header on /")

for path in PAGES:
    code, _, body = get(BASE + path)
    n = body.count(b"/cdn-cgi/")
    imgs = body.count(b"<img")
    print(f"{path:24} status={code} cdn-cgi refs={n} (<img tags: {imgs})")
    if code != 200:
        fails.append(f"{path}: HTTP {code}")
    if n:
        fails.append(f"{path}: {n} /cdn-cgi/ refs")

# sampled asset fetches carry the same stamp
_, _, home = get(BASE + "/")
import re
assets = re.findall(rb'(?:src|href)="(/[^"]+\.(?:js|css|webp|woff2))"', home)[:6]
for a in assets:
    url = BASE + a.decode()
    try:
        _, hh, _ = get(url, head=True)
        stamp = hh.get("x-46009-worker")
        print(f"asset {a.decode()[-48:]:48} stamp={stamp}")
        if stamp != live:
            fails.append(f"{a.decode()}: stamp {stamp} != live {live}")
    except Exception as e:
        fails.append(f"{a.decode()}: {e}")

if len(sys.argv) > 1:
    r = subprocess.run([sys.executable, "deploy/hooks/post-publish/lib/manifest.py",
                        "verify", "--manifest", sys.argv[1]], capture_output=True, text=True)
    print("manifest verify:", r.stdout.strip() or r.stderr.strip())
    if r.returncode != 0:
        fails.append("manifest verify non-zero")

print(f"\\nINVARIANTS: {'PASS' if not fails else 'FAIL'}")
for f in fails:
    print(" -", f)
sys.exit(1 if fails else 0)
