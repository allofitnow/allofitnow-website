#!/usr/bin/env python3
"""#70 AC6: WordPress pre-flip backup via public REST (no host credentials).

Captures, from https://allofitnow.com before the NS flip:
  - pages + posts (full REST JSON, all fields)
  - every media library object (source_url binary, size-verified vs
    media_details.filesize where present)

Output: results dir with db-content/*.json + uploads/*, plus
wp-backup-manifest.json (machine-readable, launch-gate row 70 evidence).
Stored OFF the WP host; caller uploads the results dir to the R2
archive prefix (wp-backup-<date>/).

CAVEAT (documented on #70): this is a content-level snapshot, not a
mysqldump. Users/plugins/themes/settings are not in the WP REST surface.
A true DB dump requires host credentials (user-held).

Usage: wp-backup.py [--base https://allofitnow.com] [--out DIR] [--workers 8]
"""
import argparse
import concurrent.futures as cf
import datetime
import json
import os
import sys
import urllib.request
import urllib.error

BASE_DEF = "https://allofitnow.com"


def fetch(url, timeout=120, retries=3):
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "aoin-wp-backup/1.0"})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except Exception as e:
            if attempt == retries - 1:
                raise
            print(f"  retry {attempt+1} {url}: {e}", file=sys.stderr)


def total_count(base, ep):
    req = urllib.request.Request(f"{base}/wp-json/wp/v2/{ep}?per_page=1",
                                 headers={"User-Agent": "aoin-wp-backup/1.0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return int(r.headers["X-WP-Total"])


def dump_content(base, out):
    os.makedirs(f"{out}/db-content", exist_ok=True)
    captured = {}
    for ep in ("pages", "posts"):
        n = total_count(base, ep)
        items, page = [], 1
        while len(items) < n:
            batch = json.loads(fetch(f"{base}/wp-json/wp/v2/{ep}?per_page=100&page={page}"))
            if not batch:
                break
            items.extend(batch)
            page += 1
        path = f"{out}/db-content/{ep}.json"
        json.dump(items, open(path, "w"), indent=1)
        captured[ep] = {"count": len(items), "bytes": os.path.getsize(path)}
        print(f"content {ep}: {len(items)} items -> {path}")
    return captured


def one_media(base, out, m, sem):
    url = m["source_url"]
    name = url.split("/wp-content/uploads/", 1)[-1]
    dest = f"{out}/uploads/{name}"
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    if os.path.exists(dest) and os.path.getsize(dest) > 0:
        return name, os.path.getsize(dest), "cached", m.get("media_details", {}).get("filesize")
    try:
        data = fetch(url)
        with sem:
            with open(dest, "wb") as fh:
                fh.write(data)
        return name, len(data), "ok", m.get("media_details", {}).get("filesize")
    except Exception as e:
        return name, 0, f"ERROR {e}", None


def dump_media(base, out, workers):
    os.makedirs(f"{out}/uploads", exist_ok=True)
    media, page = [], 1
    while True:
        try:
            batch = json.loads(fetch(f"{base}/wp-json/wp/v2/media?per_page=100&page={page}"))
        except urllib.error.HTTPError as e:
            if e.code == 400 and page > 1:
                # WP caps page-pagination at 100 pages; finish via offset
                off = len(media)
                while True:
                    batch = json.loads(fetch(f"{base}/wp-json/wp/v2/media?per_page=100&offset={off}"))
                    if not batch:
                        break
                    media.extend(batch)
                    off += len(batch)
                break
            raise
        if not batch:
            break
        media.extend(batch)
        page += 1
    print(f"media library: {len(media)} items")
    sem_disk = __import__("threading").Semaphore(1)  # writes serialized; net concurrent
    stats = {"ok": 0, "cached": 0, "errors": [], "bytes": 0, "mismatch": []}
    with cf.ThreadPoolExecutor(max_workers=workers) as ex:
        futs = [ex.submit(one_media, base, out, m, sem_disk) for m in media]
        for i, fut in enumerate(cf.as_completed(futs), 1):
            name, size, status, want = fut.result()
            if status.startswith("ERROR"):
                stats["errors"].append({"file": name, "error": status})
            else:
                stats[status] = stats.get(status, 0) + 1
                stats["bytes"] += size
                if want and size != want:
                    stats["mismatch"].append({"file": name, "got": size, "want": want})
            if i % 100 == 0:
                print(f"  media {i}/{len(media)}")
    return {"items": len(media), **stats}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default=BASE_DEF)
    ap.add_argument("--out", required=True)
    ap.add_argument("--workers", type=int, default=8)
    a = ap.parse_args()

    started = datetime.datetime.utcnow().isoformat() + "Z"
    os.makedirs(a.out, exist_ok=True)
    content = dump_content(a.base, a.out)
    media = dump_media(a.base, a.out, a.workers)
    manifest = {
        "kind": "wp-backup-manifest",
        "source": a.base,
        "started": started,
        "finished": datetime.datetime.utcnow().isoformat() + "Z",
        "method": "WP REST content snapshot (pages+posts JSON + media binaries, size-verified)",
        "caveat": "content-level snapshot, not mysqldump; users/plugins/themes/settings not captured (host creds user-held)",
        "content": content,
        "media": {k: v for k, v in media.items() if k != "errors"},
        "media_errors": media["errors"],
        "size_mismatch": media["mismatch"],
        "total_bytes": sum(v["bytes"] for v in content.values()) + media["bytes"],
    }
    mpath = f"{a.out}/wp-backup-manifest.json"
    json.dump(manifest, open(mpath, "w"), indent=1)
    print(json.dumps({k: manifest[k] for k in ("content", "total_bytes")}, indent=1))
    print(f"manifest: {mpath}")
    return 0 if not media["errors"] and not media["mismatch"] else 3


if __name__ == "__main__":
    sys.exit(main())
