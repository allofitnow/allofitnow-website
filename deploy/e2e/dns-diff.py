#!/usr/bin/env python3
"""#70 AC2: Route53 vs Cloudflare record-set diff for allofitnow.com.

Compares the authoritative Route53 export (deploy/dns/route53-allofitnow-export.json,
SSOT, commit 37c6b48) against live Cloudflare via API. Exit 0 IFF zero diffs
(name+type+value, TTL normalized away).

Usage: python3 deploy/e2e/dns-diff.py [--zone-id CF_ID]
Env: CF_TOKEN (read from hermes config PAT store or env).
"""
import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.request

ZONE_NAME = "allofitnow.com"
R53_EXPORT = os.path.join(os.path.dirname(__file__), "..", "dns", "route53-allofitnow-export.json")
CF_API = "https://api.cloudflare.com/client/v4"


def cf_token():
    tok = os.environ.get("CF_TOKEN")
    if tok:
        return tok
    # hermes config on .20 carries cloudflare keys (CLOUDFLARE block)
    for cfg in (os.path.expanduser("~/.hermes/profiles/glm/config.yaml"),):
        try:
            text = open(cfg).read()
        except OSError:
            continue
        m = re.search(r"(?:api_token|token|API_TOKEN):\s*([A-Za-z0-9_\-]{30,})", text)
        if m:
            return m.group(1)
    sys.exit("dns-diff: no CF token (env CF_TOKEN or hermes config)")


def cf(path, token):
    req = urllib.request.Request(f"{CF_API}{path}",
                                 headers={"Authorization": f"Bearer {token}"})
    try:
        r = urllib.request.urlopen(req, timeout=30)
    except urllib.error.HTTPError as e:
        sys.exit(f"dns-diff: CF API {path} -> HTTP {e.code}: {e.read().decode()[:200]}")
    return json.loads(r.read())["result"]


def norm_name(n):
    return n.rstrip(".").lower()


def norm_value(v):
    # Route53 quotes TXT values; CF does not. Strip quotes, collapse spaces.
    v = v.strip().strip('"')
    return re.sub(r"\s+", " ", v)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--zone-id")
    a = ap.parse_args()

    r53 = json.load(open(R53_EXPORT))
    SKIP = {"NS", "SOA"}  # zone-level, always provider-owned post-migration

    want = {}
    for r in r53:
        if r["Type"] in SKIP:
            continue
        key = (norm_name(r["Name"]), r["Type"])
        want[key] = sorted(norm_value(v["Value"]) for v in r.get("ResourceRecords", []))

    token = cf_token()
    zid = a.zone_id
    if not zid:
        zones = cf(f"/zones?name={ZONE_NAME}", token)
        if not zones:
            print(f"dns-diff: CF zone {ZONE_NAME} NOT FOUND - run CUT-1 zone-add first")
            return 1
        zid = zones[0]["id"]
        print(f"dns-diff: CF zone {zid} status={zones[0]['status']}")

    have = {}
    page = 1
    while True:
        recs = cf(f"/zones/{zid}/dns_records?per_page=100&page={page}", token)
        for r in recs:
            key = (norm_name(r["name"]), r["type"])
            # CF TXT records: content unquoted; others verbatim
            val = norm_value(r["content"]) if r["type"] in ("TXT", "SPF") else r["content"].strip().strip('"')
            have.setdefault(key, []).append(val)
        if len(recs) < 100:
            break
        page += 1
    for k in have:
        have[k] = sorted(have[k])

    diffs = 0
    for key in sorted(set(want) | set(have), key=lambda k: (k[0], k[1])):
        w, h = want.get(key), have.get(key)
        if w is None:
            print(f"DIFF: {key[0]} {key[1]} CF-only (Route53 lacks it): {h}")
            diffs += 1
        elif h is None:
            print(f"DIFF: {key[0]} {key[1]} MISSING in CF (want {w})")
            diffs += 1
        elif w != h:
            print(f"DIFF: {key[0]} {key[1]} value mismatch: r53={w} cf={h}")
            diffs += 1

    print(f"dns-diff: {len(want)} r53 sets vs {len(have)} cf sets, DIFF: {diffs}")
    return 0 if diffs == 0 else 2


if __name__ == "__main__":
    sys.exit(main())
