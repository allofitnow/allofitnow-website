import json, os
from playwright.sync_api import sync_playwright

BASE = os.environ.get("AOIN_E2E_BASE", "https://46009.someofitlater.com/")
CASES = [
    ("mobile390", 390, 844, "intro-reel_v2-1-854x480.mp4"),
    ("tablet1000", 1000, 800, "intro-reel_v2-1-1280x720.mp4"),
    ("desktop1400", 1400, 900, "intro-reel_v2-1.mp4"),
]
results = {}
with sync_playwright() as p:
    ff = p.firefox.launch()
    for name, w, h, expect in CASES:
        ctx = ff.new_context(viewport={"width": w, "height": h})
        page = ctx.new_page()
        errors, reqs = [], []
        page.on("pageerror", lambda e: errors.append("PAGEERROR: " + str(e)))
        page.on("console", lambda m: errors.append("CONSOLE-ERR: " + m.text) if m.type == "error" else None)
        page.on("request", lambda r: reqs.append(r.url) if "intro-reel" in r.url else None)
        try:
            page.goto(BASE, wait_until="load")
            page.wait_for_timeout(4500)
            q = 'video[data-ref="reelVideo"]'
            src = page.get_attribute(q, "src") or ""
            poster = page.get_attribute(q, "poster") or ""
            state = page.evaluate(
                "() => { const v = document.querySelector('video[data-ref=\"reelVideo\"]');"
                " const pre = document.querySelector('[data-ref=\"preloader\"]');"
                " return { paused: v.paused, readyState: v.readyState, currentTime: v.currentTime,"
                " preloaderHidden: !pre || getComputedStyle(pre).display === 'none' || getComputedStyle(pre).visibility === 'hidden' || getComputedStyle(pre).opacity === '0' }; }"
            )
            mp4s = sorted(set(u.split("/")[-1] for u in reqs if u.endswith(".mp4")))
            results[name] = {
                "expect": expect,
                "src_ok": expect in src,
                "poster_ok": "intro-reel_v2-1-poster.webp" in poster,
                "autoplay_ok": state["paused"] is False and state["currentTime"] > 0,
                "readyState": state["readyState"],
                "preloader_hidden": state["preloaderHidden"],
                "mp4_on_wire": mp4s,
                "only_chosen": mp4s == [expect],
                "console_clean": len(errors) == 0,
                "errors": errors[:4],
            }
        except Exception as ex:
            results[name] = {"fatal": str(ex)}
        ctx.close()
    ff.close()
print(json.dumps(results, indent=1))
ok = all(
    r.get("src_ok") and r.get("poster_ok") and r.get("autoplay_ok") and r.get("only_chosen") and r.get("console_clean")
    for r in results.values()
)
print("LIVE GATE:", "PASS" if ok else "FAIL")
