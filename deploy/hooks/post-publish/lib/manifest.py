#!/usr/bin/env bash
# manifest.py - build/verify the publish manifest for the prod sync (#49).
# build:  walk tree + media source, emit {publish_id, build_commit, timestamp,
#         keys:[{key,size,etag}], media_keys:[...]}  (etag = md5, matches
#         single-part S3 etags)
# verify: compare manifest against bucket listings; exit 1 on any divergence
#         (missing or extra objects), 0 on match. Prints a one-line verdict.
import argparse
import hashlib
import json
import os
import sys


def md5(path):
    h = hashlib.md5()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def walk_keys(root):
    out = []
    for dirpath, _dirs, files in os.walk(root):
        for name in files:
            full = os.path.join(dirpath, name)
            rel = os.path.relpath(full, root)
            out.append((rel, full))
    out.sort()
    return out


def cmd_build(args):
    keys = []
    for rel, full in walk_keys(args.tree):
        keys.append({"key": rel, "size": os.path.getsize(full), "etag": md5(full)})
    media = [rel for rel, _full in walk_keys(args.media_src)]
    manifest = {
        "publish_id": args.publish_id,
        "build_commit": args.build_commit,
        "timestamp": int(__import__("time").time()),
        "keys": keys,
        "media_keys": media,
    }
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=1, sort_keys=True)
        f.write("\n")
    print("manifest: %d tree keys, %d media keys -> %s" % (len(keys), len(media), args.out))
    return 0


def cmd_verify(args):
    with open(args.manifest, encoding="utf-8") as f:
        man = json.load(f)
    src_media = set(man["media_keys"])
    src_tree = set(k["key"] for k in man["keys"])

    bucket_media = set()
    bucket_live = set()
    with open(args.bucket_list, encoding="utf-8") as f:
        for line in f:
            parts = line.split(None, 3)
            if len(parts) < 4:
                continue
            key = parts[3].rstrip("\n")
            if args.prefix and key.startswith(args.prefix):
                key = key[len(args.prefix):]
            if key.startswith("archive/") or key.startswith("manifests/"):
                continue
            bucket_live.add(key)
            if key.startswith("media/"):
                bucket_media.add(key[len("media/"):])

    missing_media = sorted(src_media - bucket_media)
    extra_media = sorted(bucket_media - src_media)
    expected_live = set(src_tree) | set("media/" + m for m in src_media)
    missing_live = sorted(expected_live - bucket_live)
    extra_live = sorted(bucket_live - expected_live)

    ok = not (missing_media or extra_media or missing_live or extra_live)
    print("verify: %s (media %d/%d, live %d/%d)" % (
        "MATCH" if ok else "MISMATCH",
        len(bucket_media), len(src_media), len(bucket_live), len(expected_live)))
    for label, items in (("media-missing", missing_media), ("media-extra", extra_media),
                         ("live-missing", missing_live), ("live-extra", extra_live)):
        for item in items[:10]:
            print("verify: %s %s" % (label, item))
        if len(items) > 10:
            print("verify: %s ... %d more" % (label, len(items) - 10))
    return 0 if ok else 1


def main():
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("build")
    b.add_argument("--tree", required=True)
    b.add_argument("--media-src", required=True)
    b.add_argument("--publish-id", required=True)
    b.add_argument("--build-commit", default="unknown")
    b.add_argument("--out", required=True)
    b.set_defaults(fn=cmd_build)
    v = sub.add_parser("verify")
    v.add_argument("--manifest", required=True)
    v.add_argument("--bucket-list", required=True)
    v.add_argument("--prefix", default="",
                   help="scratch prefix the listing was taken under (stripped before compare)")
    v.set_defaults(fn=cmd_verify)
    args = p.parse_args()
    sys.exit(args.fn(args))


if __name__ == "__main__":
    main()
