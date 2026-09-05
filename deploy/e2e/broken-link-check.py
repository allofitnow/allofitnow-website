#!/usr/bin/env python3
"""Broken-link checker for published HTML (image srcset ladders + video rungs + posters).

Crawls the sitemap, extracts every /media/ URL referenced by the served HTML
(src/srcset/poster/data-thumb/data-lazysrcset/data-rungs JSON), resolves
relative URLs + HTML entities, and asserts each returns HTTP 200.

Usage:
    python3 broken-link-check.py                 # check prod (allofitnow.com)
    AOIN_E2E_BASE=https://46009.someofitlater.com python3 broken-link-check.py

Exit 0 = no broken links; exit 1 = one or more broken links (listed).

Notes (see playwright-e2e-verification skill):
  - Uses curl + REAL_UA: the CF edge 403s python-urllib's default UA.
  - /media/ is the only URL class that can break independently of HTML routing;
    pages themselves are guaranteed by the sitemap.
"""
import os, re, subprocess, sys

BASE = os.environ.get("AOIN_E2E_BASE", "https://allofitnow.com").rstrip("/")
REAL_UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
           "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")
MAX_TIME = "20"


def curl(url):
    return subprocess.run(
        ["curl", "-s", "-A", REAL_UA, "--max-time", MAX_TIME, url],
        capture_output=True, text=True,
    ).stdout


def status(url):
    return subprocess.run(
        ["curl", "-s", "-o", "/dev/null", "-w", "%{http_code}",
         "-A", REAL_UA, "--max-time", MAX_TIME, url],
        capture_output=True, text=True,
    ).stdout


def main():
    sitemap = curl(BASE + "/sitemap.xml")
    pages = re.findall(r"<loc>([^<]+)</loc>", sitemap)
    if not pages:
        print("ERROR: no <loc> entries in sitemap; wrong BASE?", file=sys.stderr)
        return 2

    media_re = re.compile(r'["\(]([^"\)]*?/media/[^"\)\s]+)["\)]')
    urls = set()
    for p in pages:
        html = curl(p)
        for m in media_re.findall(html):
            m = m.replace("&amp;", "&").replace("&quot;", '"').replace("&#39;", "'")
            if m.startswith("/"):
                m = BASE + m
            elif not m.startswith("http"):
                continue
            urls.add(m)

    broken = []
    for u in sorted(urls):
        code = status(u)
        if code != "200":
            broken.append((code, u.replace(BASE, "")))

    print(f"pages: {len(pages)}  media-urls: {len(urls)}  broken: {len(broken)}")
    for code, u in broken:
        print(f"  {code}  {u}")
    return 1 if broken else 0


if __name__ == "__main__":
    sys.exit(main())
