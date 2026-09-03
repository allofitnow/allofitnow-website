#!/usr/bin/env python3
"""#74 CUT-6 E2E orchestrator (run-suite).
Usage:
  python3 deploy/e2e/run-suite.py --target <host> [--pinned]
      [--skip-bfs] [--skip-bytes] [--skip-parity] [--skip-invariants]

Chain: prod-surface gates (pages/GA4/meta/canonical/sitemap/robots/www-301/
CUT-5 redirects/hostname-pin deny) + bfs-audit.py + post-bytes.py +
parity.py + invariants.py. --pinned pins all traffic to the CF edge IP: urllib legs use raw TLS with
SNI=46009.someofitlater.com (valid edge cert) + Host header = target host;
browser legs still require the zone live (host-resolver-rules can not change
SNI), so --pinned is a URLLIB-GATES-ONLY pre-flip mode (see #74 task 3).

Exit 0 = every executed stage green. Results JSON + logs ->
deploy/e2e/results/<date>-<host>-{live|pinned}/
"""
import argparse, datetime, http.client, json, os, re, socket, ssl, subprocess, sys, time
import urllib.error, urllib.parse, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
EDGE_IP = "104.21.90.237"          # CF anycast edge serving the worker (46009 lane)
EDGE_SNI = "46009.someofitlater.com"  # valid edge cert + worker route; Host header carries the target zone
GA4_ID = "G-1TVWRSCCLN"            # staging lane id (property 552018344; --target 46009.someofitlater.com)
GA4_ID_PROD = "G-NDWE8QHK9W"      # prod id (property 552145556; --target allofitnow.com)
PAGES = ["/", "/services", "/work", "/work/martin-garrix"]
REAL_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
# CUT-5 explicit MATCH 301 map (source: wiki Legacy-URL-correlation-map, DECIDED 2026-08-30)
CUT5_301 = [
    ("/project/melanie-martinez", "/work/trilogy"),
    ("/project/arcane-riot-undercity-nights", "/work/riot-x-arcane"),
    ("/project/linkin-park-from-zero", "/work/linkin-park"),
    ("/project/encanto-ar", "/work/encanto-at-the-hollywood-bowl"),
    ("/project/coldplay-bts-thevoice", "/work/coldplay-bts-ar"),
    ("/project/peso-pluma-exodo-tour", "/work/PESO-PLUMA-EXODO"),
]
# DIRECT auto-rule samples (same slug both sides; slugs live-verified on /work)
CUT5_DIRECT_SAMPLES = ["/project/martin-garrix", "/project/trilogy", "/project/riot-x-arcane"]

ap = argparse.ArgumentParser()
ap.add_argument("--target", required=True)
ap.add_argument("--pinned", action="store_true")
ap.add_argument("--gate", default=None, help="'launch' = append #74 task-8 launch-gate stage")
for s in ("bfs", "bytes", "parity", "invariants"):
    ap.add_argument(f"--skip-{s}", action="store_true")
A = ap.parse_args()
TARGET, PINNED = A.target, A.pinned
# per-host GA4 id (worker v3e+ maps Host -> Measurement ID; #71 AC3): staging lane keeps
# the 46009 id, allofitnow.com asserts the prod id. Falls back to staging id (legacy behavior).
GA4_ID = GA4_ID_PROD if TARGET == "allofitnow.com" else GA4_ID
BASE = f"https://{TARGET}"
MODE = "pinned" if PINNED else "live"
STAMP = datetime.datetime.utcnow().strftime("%Y%m%d")
OUTDIR = os.path.join(HERE, "results", f"{STAMP}-{TARGET.replace('.', '_')}-{MODE}")
os.makedirs(OUTDIR, exist_ok=True)

class _NoRedir(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None
_OPENER = urllib.request.build_opener(_NoRedir)
def fetch(url, head=False):
    """-> (status, headers-lower, body). Pinned: raw TLS to EDGE_IP, SNI=EDGE_SNI
    (valid edge cert), Host header = url host (carries the target zone)."""
    if PINNED:
        u = urllib.parse.urlparse(url); host = u.hostname
        sock = socket.create_connection((EDGE_IP, 443), timeout=30)
        tls = ssl.create_default_context().wrap_socket(sock, server_hostname=EDGE_SNI)
        conn = http.client.HTTPSConnection(host, timeout=30); conn.sock = tls
        conn.request("HEAD" if head else "GET", u.path or "/",
                     headers={"User-Agent": REAL_UA, "Host": host})
        r = conn.getresponse(); body = b"" if head else r.read()
        h = {k.lower(): v for k, v in r.getheaders()}; tls.close()
        return r.status, h, body
    req = urllib.request.Request(url, headers={"User-Agent": REAL_UA},
                                 method="HEAD" if head else "GET")
    try:
        r = _OPENER.open(req, timeout=30)
        return r.status, {k.lower(): v for k, v in r.headers.items()}, (b"" if head else r.read())
    except urllib.error.HTTPError as e:
        return e.code, {k.lower(): v for k, v in e.headers.items()}, (b"" if head else e.read())

results = {"target": TARGET, "mode": MODE, "startedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
           "gates": [], "stages": []}
FAILS = []

def gate(name, ok, detail):
    results["gates"].append({"name": name, "ok": bool(ok), "detail": str(detail)[:200]})
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}: {str(detail)[:120]}")
    if not ok:
        FAILS.append(name)

def safe_fetch(url: str, head: bool = False) -> tuple[int, dict, bytes]:
    try:
        st, h, body = fetch(url, head)
        return st, h, body if isinstance(body, bytes) else b""
    except Exception as e:
        return 0, {}, str(e)[:60].encode()

print(f"== run-suite | target={TARGET} mode={MODE} out={OUTDIR}")

# ---- surface gates -------------------------------------------------------
for path in PAGES:
    st, h, body = safe_fetch(BASE + path)
    if st != 200:
        gate(f"page {path}", False, f"HTTP {st} {body[:60].decode('utf-8','replace')}")
        continue
    b = body
    gate(f"page {path}", True, "200")
    gate(f"ga4 {path}", GA4_ID.encode() in b, f"{GA4_ID} in HTML")
    gate(f"title {path}", bool(re.search(rb"<title>[^<]{3,}</title>", b)), "non-empty <title>")
    gate(f"description {path}", b'name="description"' in b, 'meta name="description"')
    gate(f"og {path}", b'property="og:' in b, "og:* tags")
    gate(f"twitter {path}", b'name="twitter:' in b, "twitter:* tags")
    gate(f"canonical {path}",
         bool(re.search(rb'<link[^>]+rel="canonical"[^>]+href="https://' + re.escape(TARGET.encode()) + rb'/', b)),
         "canonical -> https://" + TARGET)

st, h, body = safe_fetch(BASE + "/sitemap.xml")
has_urlset = st == 200 and b"<urlset" in body
gate("sitemap", has_urlset, f"HTTP {st}, urlset={has_urlset}")
st, h, body = safe_fetch(BASE + "/robots.txt")
is_ph = b"content signals" in body.lower()
gate("robots", st == 200 and not is_ph and len(body) > 20,
     f"HTTP {st}, {len(body)}B, placeholder={is_ph}")

if TARGET == "allofitnow.com":
    st, h, body = safe_fetch("https://www.allofitnow.com/")
    loc = h.get("location", "")
    gate("www-301", st == 301 and loc.rstrip("/") == "https://allofitnow.com", f"HTTP {st} -> {loc}")
else:
    print("  [SKIP] www-301: only for --target allofitnow.com")

# CUT-5 301s are absolute to the apex by worker design (v3e+, #73):
# Location is always https://allofitnow.com/<target> regardless of lane.
APEX = "https://allofitnow.com"
for old, new in CUT5_301:
    st, h, body = safe_fetch(BASE + old)
    loc = h.get("location", "")
    gate(f"cut5 {old}", st == 301 and loc == APEX + new, f"HTTP {st} -> {loc}")
for old in CUT5_DIRECT_SAMPLES:
    st, h, body = safe_fetch(BASE + old)
    loc = h.get("location", "")
    want = APEX + old.replace("/project/", "/work/")
    gate(f"cut5-direct {old}", st == 301 and loc == want, f"HTTP {st} -> {loc} (want {want})")

st, h, body = safe_fetch(BASE + "/")  # hostname pin deny (worker v3d pin)
if PINNED:
    evil_host = urllib.parse.urlparse(BASE).hostname or TARGET
    sock = socket.create_connection((EDGE_IP, 443), timeout=30)
    tls = ssl.create_default_context().wrap_socket(sock, server_hostname=EDGE_SNI)
    conn = http.client.HTTPSConnection(evil_host, timeout=30); conn.sock = tls
    conn.request("GET", "/", headers={"User-Agent": REAL_UA, "Host": "evil.example"})
    r = conn.getresponse(); body = r.read(); st = r.status; tls.close()
else:
    req = urllib.request.Request(BASE + "/", headers={"User-Agent": REAL_UA, "Host": "evil.example"})
    try:
        r = _OPENER.open(req, timeout=30); st = r.status
    except urllib.error.HTTPError as e:
        st = e.code
gate("hostname-pin deny", st == 403, f"Host: evil.example -> HTTP {st}")

# ---- subprocess stages --------------------------------------------------
ENV = dict(os.environ, AOIN_E2E_TARGET=TARGET)
if PINNED:
    ENV["AOIN_E2E_PIN_IP"] = EDGE_IP

def stage(name, cmd, timeout_s, cwd=ROOT):
    print(f"== stage {name}: {' '.join(cmd)}")
    t0 = time.time()
    try:
        r = subprocess.run(cmd, cwd=cwd, env=ENV, timeout=timeout_s,
                           capture_output=True, text=True)
        tail = (r.stdout or "").strip().splitlines()[-8:]
        ok = r.returncode == 0
    except subprocess.TimeoutExpired as e:
        tail = ["TIMEOUT"]; ok = False; r = None
    dt = round(time.time() - t0, 1)
    results["stages"].append({"name": name, "ok": ok, "seconds": dt, "tail": tail})
    print("\n".join("  | " + t for t in tail))
    print(f"== stage {name}: {'PASS' if ok else 'FAIL'} ({dt}s)")
    if not ok:
        FAILS.append(name)
    return ok

if not A.skip_bfs:
    stage("bfs-audit", [sys.executable, os.path.join(HERE, "bfs-audit.py")], 1800)
if not A.skip_bytes:
    stage("post-bytes", [sys.executable, os.path.join(HERE, "post-bytes.py"), os.path.join(OUTDIR, "post")], 900)
    if not A.skip_parity:
        boxes = os.path.join(OUTDIR, "post-boxes")
        stage("capture-boxes", [sys.executable, os.path.join(HERE, "baseline-20260830", "capture-boxes.py"), boxes], 900)
        stage("parity", [sys.executable, os.path.join(HERE, "parity.py"),
                         os.path.join(boxes, "boxes.json"),
                         os.path.join(HERE, "baseline-20260830"),
                         os.path.join(OUTDIR, "post")], 600)
if not A.skip_invariants:
    stage("invariants", [sys.executable, os.path.join(HERE, "invariants.py")], 300)

if A.gate == "launch":
    gate_cmd = [sys.executable, os.path.join(HERE, "launch-gate.py"),
                "--target", TARGET]
    if PINNED:
        gate_cmd.append("--pinned")
    stage("launch-gate", gate_cmd, 900)

results["finishedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
results["exit"] = "PASS" if not FAILS else "FAIL"
results["failed"] = FAILS
with open(os.path.join(OUTDIR, "suite-results.json"), "w") as f:
    json.dump(results, f, indent=1)
print(f"\nRUN-SUITE: {results['exit']}" + (f" (failed: {', '.join(FAILS)})" if FAILS else ""))
print(f"results: {OUTDIR}")
sys.exit(0 if not FAILS else 1)
