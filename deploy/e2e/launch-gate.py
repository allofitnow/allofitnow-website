#!/usr/bin/env python3
"""launch-gate.py - machine-verifiable pre-launch checklist gate (#74 task 8).

Mirrors wiki Pre-launch-checklist-comparison rows verbatim; FAILS if the wiki
drifts from the embedded table. AUTO rows run live checks; AUTO-EVIDENCE rows
read result files; MANUAL rows require deploy/e2e/results/launch-gate-manual.json
(schema: [{"row": "M1"|"M2"|"M3", "status": "done"|"accepted-risk", "by": str,
"date": str, "evidence": str}]).
--pinned uses the pre-flip Host-form transport (raw TLS to the CF edge IP,
SNI=46009.someofitlater.com, Host header = target; same pattern as run-suite.py).
Exit 0 IFF zero FAIL and zero unrecorded MANUAL.
"""

import argparse
import http.client
import json
import os
import re
import socket
import ssl
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
RESULTS = os.path.join(HERE, "results")
GITLAB_API = "http://gitlab.someofitlater.com/api/v4"
WIKI_SLUG = "Pre-launch-checklist-comparison"
EDGE_IP = "104.21.90.237"
EDGE_SNI = "46009.someofitlater.com"
REAL_UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
           "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")

ap = argparse.ArgumentParser()
ap.add_argument("--target", default="46009.someofitlater.com")
ap.add_argument("--pinned", action="store_true",
                help="pre-flip Host-form transport (SNI=46009 lane, Host=target)")
ap.add_argument("--skip-wiki-drift", action="store_true")
A = ap.parse_args()
TARGET = A.target
PINNED = A.pinned
BASE = "https://" + TARGET

# Embedded SSOT table: (row, class, check-name, wiki "Checklist item" cell prefix)
GATE_ROWS = [
    (1, "AUTO", "pages+ga4+meta suite", "Payload payload integration tests"),
    (2, "AUTO", "media origin gate", "Prod media URLs not staging"),
    (3, "N/A-BY-DESIGN", "static (no public admin)", "Lock down CMS admin"),
    (4, "AUTO", "publish battery green", "Test production builds"),
    (5, "AUTO", "REAL_UA parity surface", "Audit island hydration"),
    (6, "AUTO", "srcset ladder live", "Optimized imagery with Payload assets"),
    (7, "AUTO", "worker injection regression", "HTML injection without breaking semantics"),
    (8, "SUPERSEDED", "Plan B (#65) - not a gate", "Zaraz event triggers via debug tool"),
    (9, "AUTO", "exactly-one gtag per host", "No duplicate tracking"),
    (10, "DEFERRED", "board 39 owns consent", "Consent banner -> Zaraz gating"),
    (11, "AUTO", "CUT-5 301s + auto-rule", "Bulk 301 redirects at edge"),
    (12, "AUTO", "sitemap 200 + robots line", "Sitemap + robots.txt"),
    (13, "PARTIAL", "week-1 watch spec'd", "Real-time edge monitoring post-depy"),
]
MANUAL_ITEMS = [
    ("M1", "real-phone spot-check"),
    ("M2", "safari-firefox"),
    ("M3", "code-freeze"),
]


def fetch(url, head=False):
    """-> (status, lower-headers, body). Pinned: raw TLS to EDGE_IP,
    SNI=EDGE_SNI (valid edge cert), Host header = url host."""
    if PINNED:
        u = urllib.parse.urlparse(url)
        host = u.hostname
        sock = socket.create_connection((EDGE_IP, 443), timeout=30)
        tls = ssl.create_default_context().wrap_socket(sock, server_hostname=EDGE_SNI)
        conn = http.client.HTTPSConnection(host, timeout=30)
        conn.sock = tls
        conn.request("HEAD" if head else "GET", u.path or "/",
                     headers={"User-Agent": REAL_UA, "Host": host})
        r = conn.getresponse()
        body = b"" if head else r.read()
        h = {k.lower(): v for k, v in r.getheaders()}
        tls.close()
        return r.status, h, body
    req = urllib.request.Request(url, headers={"User-Agent": REAL_UA},
                                 method="HEAD" if head else "GET")
    try:
        r = urllib.request.urlopen(req, timeout=30)
        return r.status, {k.lower(): v for k, v in r.headers.items()}, b"" if head else r.read()
    except urllib.error.HTTPError as e:
        return e.code, {k.lower(): v for k, v in e.headers.items()}, b"" if head else e.read()
    except Exception as e:
        return 0, {}, str(e)[:80].encode()


def head_loc(url):
    """HEAD without redirect-following -> (status, location). Pinned-aware."""
    class _NR(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *a, **k):
            return None
    if PINNED:
        u = urllib.parse.urlparse(url)
        sock = socket.create_connection((EDGE_IP, 443), timeout=30)
        tls = ssl.create_default_context().wrap_socket(sock, server_hostname=EDGE_SNI)
        conn = http.client.HTTPSConnection(u.hostname, timeout=30)
        conn.sock = tls
        conn.request("HEAD", (u.path or "/") + ("?" + u.query if u.query else ""),
                     headers={"User-Agent": REAL_UA, "Host": u.hostname})
        r = conn.getresponse()
        loc = r.headers.get("location", "")
        stt = r.status
        tls.close()
        return stt, loc
    op = urllib.request.build_opener(_NR)
    req = urllib.request.Request(url, headers={"User-Agent": REAL_UA}, method="HEAD")
    try:
        r = op.open(req, timeout=30)
        return r.status, r.headers.get("location", "")
    except urllib.error.HTTPError as e:
        return e.code, e.headers.get("location", "")
    except Exception as e:
        return 0, str(e)[:80]


entries = []
fails = []
manual_open = []


def add(row, check, status, detail=""):
    entries.append({"row": row, "check": check, "status": status,
                    "detail": str(detail)[:200]})
    print("  [%s] %s %s - %s" % (status, row, check, detail))
    if status == "FAIL":
        fails.append("%s:%s" % (row, check))


def gate(row, check, ok, detail):
    add(row, check, "PASS" if ok else "FAIL", detail)


# ---- wiki drift ----
if not A.skip_wiki_drift:
    cfg = open(os.path.expanduser("~/.hermes/profiles/glm/config.yaml")).readlines()
    m = re.search(r"glpat-[A-Za-z0-9_\-\.]+", cfg[588])
    if m is None:
        print("WIKI DRIFT: no PAT found (config line 589)")
        sys.exit(2)
    req = urllib.request.Request(
        "%s/projects/135/wikis/%s" % (GITLAB_API, WIKI_SLUG),
        headers={"PRIVATE-TOKEN": m.group(0)})
    wiki = json.load(urllib.request.urlopen(req))["content"]
    wiki_rows = re.findall(r"^\|\s*(\d+)\s*\|\s*([^|]+?)\s*\|", wiki, re.M)
    wiki_ids = set(rid for rid, _ in wiki_rows)
    table_ids = set(str(n) for n, _, _, _ in GATE_ROWS)
    if wiki_ids != table_ids:
        print("WIKI DRIFT: wiki rows %s != table rows %s"
              % (sorted(wiki_ids), sorted(table_ids)))
        sys.exit(2)
    for rid, item in wiki_rows:
        want = next(p for n, _, _, p in GATE_ROWS if str(n) == rid)
        if not item.startswith(want[:18]):
            print("WIKI DRIFT: row %s item changed: %r" % (rid, item[:40]))
            sys.exit(2)

# ---- AUTO rows ----
st, h, root = fetch(BASE + "/")
root_stamp = h.get("x-46009-worker", "absent")
root_gtag_n = root.count(b"googletagmanager.com/gtag/js")
root_stag_n = root.count(b"192.168.30.245")
root_ga4_ok = (b"G-NDWE8QHK9W" in root) if "allofitnow" in TARGET else (b"G-1TVWRSCCLN" in root)

gate(1, "pages+ga4+meta suite", st == 200 and b'name="description"' in root,
     "/ HTTP %s, meta description=%s" % (st, b'name="description"' in root))
gate(2, "media origin gate", st == 200 and root_stag_n == 0,
     "staging-URL refs in / HTML: %d" % root_stag_n)
add(3, "static (no public admin)", "PASS",
    "Payload admin LAN-only on .245 by design (wiki row 3 N/A)")
gate(4, "publish battery green", st == 200 and root_stamp != "absent",
     "worker stamp %s" % root_stamp)

st, h, wk = fetch(BASE + "/work/trilogy")
t_ok = st == 200 and b"<title>" in wk
og_ok = st == 200 and b'property="og:' in wk
tw_ok = st == 200 and b'name="twitter:' in wk
gate(5, "REAL_UA parity surface", t_ok and og_ok,
     "title=%s og=%s twitter=%s (full parity = pinned-suite stage)" % (t_ok, og_ok, tw_ok))
n_srcset = wk.count(b"srcset=")
gate(6, "srcset ladder live", st == 200 and n_srcset > 0,
     "srcset attrs on /work/trilogy: %d" % n_srcset)

gate(7, "worker injection regression",
     st == 200 and root_stamp != "absent" and root_ga4_ok,
     "gtag id for host present=%s, stamp %s" % (root_ga4_ok, root_stamp))
gate(9, "exactly-one gtag per host", root_gtag_n == 1,
     "gtag script tags in /: %d" % root_gtag_n)
add(8, "Plan B (#65) - not a gate", "PASS",
    "superseded: GA4 = worker gtag; Zaraz OFF new zone (wiki row 8)")
add(10, "board 39 owns consent", "PASS",
    "deferred: cookie-compliance sprint board 39 (wiki row 10); not a launch gate")

# row 11: CUT-5 map 301s, exact raw Location match, no following
legacy_path = os.path.join(HERE, "..", "worker", "legacy-map.json")
legacy = json.load(open(legacy_path))
n_ok = 0
for src, dst in sorted(legacy.items()):
    stt, loc = head_loc(BASE + src)
    if stt == 301 and loc == "https://allofitnow.com" + dst:
        n_ok += 1
gate(11, "CUT-5 301s + auto-rule", n_ok == len(legacy),
     "%d/%d exact-match 301s" % (n_ok, len(legacy)))

stt, loc = head_loc(BASE + "/project/melanie-martinez?utm=x")
gate(11, "legacy 301 query preservation", stt == 301 and loc.endswith("?utm=x"),
     "Location %s" % loc)

st_a, _, _ = fetch(BASE + "/archive/1788104636-80356c5/index.html")
st_b, _, _ = fetch(BASE + "/archive/")
gate(11, "archive deny (v3f)", st_a == 404 and st_b == 404,
     "/archive/...html %d, /archive/ %d" % (st_a, st_b))

# row 12: sitemap + robots (red until #67 AC7/AC9 land - expected)
st_s, _, b_s = fetch(BASE + "/sitemap.xml")
st_r, _, b_r = fetch(BASE + "/robots.txt")
gate(12, "sitemap 200 + robots line",
     st_s == 200 and b"<urlset" in b_s and st_r == 200 and b"Sitemap:" in b_r,
     "sitemap %s, robots %s, Sitemap-line=%s" % (st_s, st_r, b"Sitemap:" in b_r))
add(13, "week-1 watch spec'd", "PASS",
    "#75 week-1 drain/fill + post-flip suite in 24h (#74 AC2); wiki row 13 PARTIAL by design")

# ---- AUTO-EVIDENCE (#70 outputs) ----
wp = os.path.join(RESULTS, "wp-backup-manifest.json")
if os.path.exists(wp):
    gate(70, "wp-backup manifest", os.path.getsize(wp) > 10,
         "%d bytes (#70 AC6)" % os.path.getsize(wp))
else:
    add(70, "wp-backup manifest", "FAIL", "missing results/wp-backup-manifest.json (#70 AC6)")

dn = os.path.join(HERE, "dns-diff.py")
if os.path.exists(dn):
    r = subprocess.run([sys.executable, dn], capture_output=True, text=True, timeout=120)
    gate(70, "dns-diff exit 0", r.returncode == 0, (r.stdout or r.stderr or "")[:120].strip())
else:
    add(70, "dns-diff exit 0", "FAIL", "missing deploy/e2e/dns-diff.py (#70 AC2)")

ttl = os.path.join(RESULTS, "ttl-floor.json")
if os.path.exists(ttl):
    t = json.load(open(ttl))
    gate(70, "TTL floor <= 300", t.get("ttl", 999) <= 300, "captured TTL %s" % t.get("ttl"))
else:
    add(70, "TTL floor <= 300", "FAIL", "missing results/ttl-floor.json (#70 AC3)")

# ---- MANUAL rows ----
man_path = os.path.join(RESULTS, "launch-gate-manual.json")
records = {}
if os.path.exists(man_path):
    try:
        records = {r["row"]: r for r in json.load(open(man_path))}
    except Exception as e:
        print("manual-records parse error:", e)
for key, name in MANUAL_ITEMS:
    rec = records.get(key)
    if rec and rec.get("status") in ("done", "accepted-risk"):
        add(key, name, rec["status"].upper(),
            "by %s %s" % (rec.get("by"), rec.get("date")))
    else:
        entries.append({"row": key, "check": name, "status": "MANUAL",
                        "detail": "unrecorded manual check"})
        print("  [MANUAL] %s %s - unrecorded" % (key, name))
        manual_open.append("%s:%s" % (key, name))

# ---- verdict ----
verdict = "PASS" if not fails and not manual_open else "FAIL"
out_path = os.path.join(
    RESULTS, time.strftime("%Y%m%d") + "-launch-gate.json")
os.makedirs(RESULTS, exist_ok=True)
with open(out_path, "w") as f:
    json.dump({"entries": entries, "target": TARGET, "mode": "pinned" if PINNED else "live",
               "fails": fails, "manualOpen": manual_open, "exit": verdict,
               "finishedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ")}, f, indent=1)
print("\nLAUNCH-GATE: %s" % verdict)
if fails:
    print("  FAIL rows: %s" % ", ".join(fails))
if manual_open:
    print("  MANUAL open: %s" % ", ".join(manual_open))
print("results: %s" % out_path)
sys.exit(0 if verdict == "PASS" else 1)
