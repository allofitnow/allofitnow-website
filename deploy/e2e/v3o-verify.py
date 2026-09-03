#!/usr/bin/env python3
"""#123 v3o verification: zaraz stripped, GA4 single-load, headers bumped."""
import re, subprocess, sys

HOSTS = {
    "allofitnow.com": "104.21.85.13",
    "46009.someofitlater.com": "104.21.90.237",
}
ok = True
for host, edge in HOSTS.items():
    html = subprocess.run(
        ["curl", "-s", "--resolve", f"{host}:443:{edge}", f"https://{host}/"],
        capture_output=True, text=True, timeout=30).stdout
    hdr = subprocess.run(
        ["curl", "-s", "-o", "/dev/null", "-w", "%{header_json}",
         "--resolve", f"{host}:443:{edge}", f"https://{host}/"],
        capture_output=True, text=True, timeout=30).stdout
    ver = re.search(r"x-46009-worker[\"':\s]+(v\d+\w*)", hdr)
    zaraz = html.count("cdn-cgi/zaraz")
    gtm = html.count("googletagmanager")
    ids = {m: html.count(m) for m in sorted(set(re.findall(r"G-[A-Z0-9]{8,}", html)))}
    shim = html.count("inquiry_send")
    print(f"[{host}] worker={ver.group(1) if ver else 'MISSING'} zaraz={zaraz} gtm-loader={gtm} ga4={ids} shim-inquiry_send={shim}")
    if zaraz != 0: ok = False; print(f"  FAIL AC1: zaraz refs {zaraz}")
    if gtm != 1: ok = False; print(f"  FAIL AC2: googletagmanager x{gtm} (want 1)")
    if not ver or ver.group(1) != "v3o": ok = False; print("  FAIL AC2: header not v3o")
    if not shim: ok = False; print("  FAIL AC2: SHIM inquiry_send gone")
print("VERIFY:", "PASS" if ok else "FAIL")
sys.exit(0 if ok else 1)
