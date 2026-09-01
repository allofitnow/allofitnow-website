#!/usr/bin/env python3
"""normalize_urls.py - publish-time same-domain http->https rewriter (#69).

Runs in prod.sh BEFORE manifest build (so the manifest captures rewritten
URLs). Scans the translated build tree for any absolute URL whose authority
is in OUR domain set and whose scheme is http: and rewrites it to https: in
place. Relative and scheme-relative URLs pass through untouched. External
http:// URLs (Class B) are intentionally NOT rewritten - designer-fixed per
the #68 audit split.

Usage: normalize_urls.py --tree <dir> [--domains d1,d2,...] [--dry-run]
Prints one line per rewrite: "<relpath>: http://... -> https://..."
Exit 0 always (pipeline lint pass, never blocks); nonzero only on argparse/env
errors.
"""
import argparse
import os
import re
import sys

DEFAULT_DOMAINS = [
    "46009.someofitlater.com",
    "allofitnow.com",
    "www.allofitnow.com",
]
EXTS = (".html", ".css", ".js", ".json", ".svg", ".xml", ".txt")

# http://our-domain in any textual context (attributes, JSON-LD, css url()).
# Scheme-relative and protocol-free forms are untouched by design.
def build_pattern(domains):
    alts = "|".join(re.escape(d) for d in domains)
    return re.compile(r"http://(?:%s)([:/?#\"'\s)]|$)" % alts)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tree", required=True)
    ap.add_argument("--domains", default=",".join(DEFAULT_DOMAINS))
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    pat = build_pattern([d.strip() for d in args.domains.split(",") if d.strip()])
    rewrites = 0
    files = 0
    for root, _dirs, names in os.walk(args.tree):
        for n in names:
            if not n.endswith(EXTS):
                continue
            p = os.path.join(root, n)
            try:
                with open(p, "r", encoding="utf-8", errors="surrogateescape") as f:
                    src = f.read()
            except OSError:
                continue
            if "http://" not in src:
                continue
            new, n_sub = pat.subn(lambda m: "https://" + m.group(0)[7:], src)
            if n_sub == 0:
                continue
            files += 1
            rewrites += n_sub
            rel = os.path.relpath(p, args.tree)
            # print one line per rewrite (first old->new per file keeps log sane)
            m = pat.search(src)
            if m:
                print("%s: %d URL(s) rewritten (e.g. %s)" % (rel, n_sub, m.group(0).strip()))
            if not args.dry_run:
                with open(p, "w", encoding="utf-8", errors="surrogateescape") as f:
                    f.write(new)
    print("normalize: %d file(s), %d URL(s) rewritten%s" % (files, rewrites, " (dry-run)" if args.dry_run else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
