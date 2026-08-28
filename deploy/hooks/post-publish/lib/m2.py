#!/usr/bin/env python3
"""M2 selector presence engine (Zaraz spec module M2, Tier-1).

Read-only against the site: fetches served pages from --origin, counts
dictionary selectors per page, compares against a pinned baseline with
variance-aware escalation. Writes ONLY the --baseline file and the --out
JSON (runtime state lives under /opt/aoin-tracking or /tmp scratch, never
inside a git checkout).

Roster: static pages named by the dictionary plus every project page found
as work/<slug>/index.html under --tree. Rows with page 'all' run on every
roster page.

Verdicts per (page, row): OK / MISSING / COUNT-CHANGED / LOG_COUNT_CHANGE.
Pages new to the roster or gone from it are NEW / DEAD (logged, never
escalated: designer curation).

Exit codes: 0 = green or log-only drift, 1 = escalate, 2 = fatal.
"""
import argparse
import json
import fnmatch
import os
import sys
import time
import urllib.request

from bs4 import BeautifulSoup


def load_rows(path):
    import yaml
    with open(path, "r", encoding="utf-8") as fh:
        data = yaml.safe_load(fh)
    rows = data.get("rows") or []
    if not rows:
        raise ValueError("dictionary has no rows")
    for r in rows:
        for key in ("id", "page", "selector", "variance"):
            if key not in r:
                raise ValueError("dictionary row missing key %s: %r" % (key, r))
    return rows


def roster(rows, tree):
    pages = []
    for r in rows:
        p = r["page"]
        if p == "all" or "*" in p:
            continue  # 'all' and glob patterns contribute no literal page
        if p not in pages:
            pages.append(p)
    workdir = os.path.join(tree, "work")
    if os.path.isdir(workdir):
        for slug in sorted(os.listdir(workdir)):
            if slug.startswith("."):
                continue
            if os.path.isfile(os.path.join(workdir, slug, "index.html")):
                p = "/work/%s/" % slug
                if p not in pages:
                    pages.append(p)
    return pages


def rows_for(rows, page):
    out = []
    for r in rows:
        p = r["page"]
        if p == page or p == "all" or ("*" in p and fnmatch.fnmatch(page, p)):
            out.append(r)
    return out


def fetch(origin, page, timeout=10):
    url = origin.rstrip("/") + page
    req = urllib.request.Request(url, headers={"User-Agent": "aoin-m2/1"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8", "replace")


def count_page(html, rows, page):
    soup = BeautifulSoup(html, "html.parser")
    return {str(r["id"]): len(soup.select(r["selector"])) for r in rows_for(rows, page)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--origin", required=True)
    ap.add_argument("--tree", required=True)
    ap.add_argument("--dictionary", required=True)
    ap.add_argument("--baseline", required=True)
    ap.add_argument("--mode", choices=["pin", "check"], required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    def emit(obj, code):
        obj["generated_at"] = int(time.time())
        with open(args.out, "w", encoding="utf-8") as fh:  # --out JSON (ledger input; /tmp scratch ok)
            json.dump(obj, fh, indent=1, sort_keys=True)
        return code

    try:
        rows = load_rows(args.dictionary)
    except Exception as e:
        print("FATAL dictionary: %s" % e, file=sys.stderr)
        return 2

    base = None
    if args.mode == "check":
        if not os.path.isfile(args.baseline):
            print("FATAL baseline %s missing; run --mode pin first" % args.baseline, file=sys.stderr)
            return 2
        try:
            with open(args.baseline, "r", encoding="utf-8") as fh:
                base = json.load(fh)
        except Exception as e:
            print("FATAL baseline unparsable: %s" % e, file=sys.stderr)
            return 2

    pages = roster(rows, args.tree)
    counts = {}
    for p in pages:
        try:
            html = fetch(args.origin, p)
        except Exception as e:
            print("FATAL fetch %s: %s" % (p, e), file=sys.stderr)
            return emit({"mode": args.mode, "pages_checked": 0, "verdicts": [],
                         "escalate": False,
                         "summary": "fatal: fetch failed for %s; escalate=false (fatal class)" % p}, 2)
        counts[p] = count_page(html, rows, p)

    if args.mode == "pin":
        doc = {"pinned_at": int(time.time()), "counts": counts}
        with open(args.baseline, "w", encoding="utf-8") as fh:  # baseline lives under /opt/aoin-tracking (never in a checkout)
            json.dump(doc, fh, indent=1, sort_keys=True)
        return emit({"mode": "pin", "pages_checked": len(pages), "verdicts": [],
                     "escalate": False,
                     "summary": "pinned %d pages, %d rows counted; escalate=false" % (
                         len(pages), sum(len(v) for v in counts.values()))}, 0)

    bcounts = base.get("counts", {})
    verdicts = []
    tally = {}
    escalate = False

    def mark(v):
        tally[v] = tally.get(v, 0) + 1

    for p in pages:
        if p not in bcounts:
            verdicts.append({"page": p, "row": None, "verdict": "NEW"})
            mark("NEW")
            continue
        for r in rows_for(rows, p):
            rid = str(r["id"])
            if rid not in bcounts[p]:
                verdicts.append({"page": p, "row": rid, "verdict": "NEW"})
                mark("NEW")
                continue
            n = counts[p].get(rid, 0)
            b = bcounts[p][rid]
            if r["variance"] == "structural":
                if n == 0:
                    v = "MISSING"
                    escalate = True
                elif n != b:
                    v = "COUNT-CHANGED"
                    escalate = True
                else:
                    v = "OK"
            else:
                if n == 0 and b > 0:
                    v = "MISSING"
                    escalate = True
                elif n != b:
                    v = "LOG_COUNT_CHANGE"
                else:
                    v = "OK"
            verdicts.append({"page": p, "row": rid, "verdict": v, "count": n, "baseline": b})
            mark(v)
    for p in sorted(set(bcounts) - set(counts)):
        verdicts.append({"page": p, "row": None, "verdict": "DEAD"})
        mark("DEAD")

    summary = "pages_checked=%d %s escalate=%s" % (
        len(pages),
        " ".join("%s=%d" % (k, tally[k]) for k in sorted(tally)),
        "true" if escalate else "false")
    code = 1 if escalate else 0
    return emit({"mode": "check", "pages_checked": len(pages), "verdicts": verdicts,
                 "escalate": escalate, "summary": summary}, code)


if __name__ == "__main__":
    sys.exit(main())
