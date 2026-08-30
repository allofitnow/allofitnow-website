#!/usr/bin/env python3
"""#61 parity gate: post-state vs baseline-20260830.
(a) identical rendered doc dimensions; (b) identical img layout boxes
(vs boxes.json; format-only tolerance); (c) pixel diff per viewport:
<=1% of pixels with channel delta >3/255, zero structural diff.
Usage: parity.py <post_boxes.json> <baseline_dir> <post_dir>"""
import json, sys, os
import numpy as np
from PIL import Image

post_boxes, baseline_dir, post_dir = sys.argv[1], sys.argv[2], sys.argv[3]
base_boxes = json.load(open(os.path.join(baseline_dir, "boxes.json")))["runs"]
boxes = json.load(open(post_boxes))["runs"]
fails = []

bi = {f'{r["viewport"]}|{r["page"]}': r for r in base_boxes}
for r in boxes:
    key = f'{r["viewport"]}|{r["page"]}'
    b = bi.get(key)
    if not b:
        fails.append(f"{key}: no baseline entry"); continue
    if (b["docW"], b["docH"]) != (r["docW"], r["docH"]):
        fails.append(f"{key}: doc dims {b['docW']}x{b['docH']} -> {r['docW']}x{r['docH']}")
    if len(b["imgs"]) != len(r["imgs"]):
        fails.append(f"{key}: img count {len(b['imgs'])} -> {len(r['imgs'])}")
    for i, (ob, nb) in enumerate(zip(b["imgs"], r["imgs"])):
        if ob["box"] != nb["box"]:
            fails.append(f"{key} img#{i} {ob['src']}: box {ob['box']} -> {nb['box']} ({nb['src']})")
    vp = r["viewport"]
    name = f"{vp}_{r['page'].strip('/').replace('/', '_') or 'home'}.png"
    bp, pp = os.path.join(baseline_dir, name), os.path.join(post_dir, name)
    if not (os.path.exists(bp) and os.path.exists(pp)):
        fails.append(f"{key}: missing screenshot"); continue
    A = np.asarray(Image.open(bp).convert("RGB"), dtype=np.int16)
    B = np.asarray(Image.open(pp).convert("RGB"), dtype=np.int16)
    if A.shape != B.shape:
        fails.append(f"{key}: screenshot shape {A.shape} vs {B.shape}"); continue
    diff = np.abs(A - B).max(axis=2)
    pct = 100.0 * (diff > 3).mean()
    ok = pct <= 1.0
    print(f"pixels {name}: {pct:.3f}% >3/255 {'PASS' if ok else 'FAIL'}")
    if not ok:
        fails.append(f"{key}: pixel diff {pct:.3f}% >1%")

print(f"\\nPARITY: {'PASS' if not fails else 'FAIL'}")
for f in fails:
    print(" -", f)
sys.exit(1 if fails else 0)
