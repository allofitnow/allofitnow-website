#!/usr/bin/env python3
"""Build + PUT the full 25-trigger Zaraz config from tracking-dictionary.yaml (SSOT).
Wire formats verified empirically 2026-08-29:
- clickListener: {id, action:"clickListener", settings:{selector, type:"css", waitForTags}}
- elementVisibility: {id, action:"elementVisibility", settings:{selector}}
- page scope rule: {match:"{{ client.system.page.url.pathname }}", op:"MATCH_REGEX", value:"^/x/?$"}
- GA4 action: {actionType:"event", data:{en:<event>, <param>:"{{ client.<attr> }}"}, firingTriggers:[tid]}
- custom-html tool: component cloudflare/custom-html, action {actionType:"html", data:{html:<js>}}
Trigger 21 (input .value = DOM property, not attribute): no direct GA4 action;
shim tool injects zaraz.track('inquiry_send',{subject}) -> AllTracks forwards once.
"""
import re, json, copy, sys, urllib.request, urllib.error

TOKEN = re.search(r"API_TOKEN=([^\s]+)", open("/home/aoin/.ssh/CLOUDFLARE").read()).group(1)
ZID = "3e256a5c0f3a43c4cf83d25571ee5e57"

def api(method, path, payload=None):
    req = urllib.request.Request(f"https://api.cloudflare.com/client/v4/zones/{ZID}/{path}",
                                 data=json.dumps(payload).encode() if payload is not None else None,
                                 headers={"Authorization": "Bearer " + TOKEN, "Content-Type": "application/json"},
                                 method=method)
    try:
        r = urllib.request.urlopen(req, timeout=20)
        return r.status, json.load(r)
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode())

# ---- load SSOT (yaml lib preferred, regex fallback) ----
DICT_PATH = "/tmp/p46/repo/deploy/tracking-dictionary.yaml"
rows = None
try:
    import yaml
    rows = yaml.safe_load(open(DICT_PATH))["rows"]
except Exception as e:
    print("yaml path failed (%s), regex fallback" % e)
    rows = []
    pat = re.compile(
        r"\{id:\s*(\d+),\s*page:\s*([^,]+),\s*selector:\s*'([^']+)',\s*trigger:\s*(\w+),\s*"
        r"event:\s*(\w+),\s*params:\s*\[([^\]]*)\]")
    for m in pat.finditer(open(DICT_PATH).read()):
        rid, page, sel, trig, ev, params = m.groups()
        rows.append({
            "id": int(rid), "page": page.strip(), "selector": sel, "trigger": trig,
            "event": ev, "params": [p.strip() for p in params.split(",") if p.strip()],
        })
assert len(rows) == 25, f"expected 25 rows, got {len(rows)}"

# ---- fetch live config ----
st, live = api("GET", "settings/zaraz/config")
assert st == 200, live
BASE = live["result"]
json.dump(BASE, open("/tmp/zaraz-prebuild-config.json", "w"), indent=1)  # rollback artifact

def page_rules(pathspec):
    if pathspec == "all":
        return []
    def to_regex(v):
        v = v.strip()
        if v in ("/", ""):
            return "/"
        return re.escape(v.rstrip("/")).replace("\\*", "[^/]+")
    vals = [v.strip() for v in pathspec.split(",")] if "," in pathspec else [pathspec]
    alts = [to_regex(v) for v in vals]
    val = "^(" + "|".join(alts) + ")/?$"
    return [{"match": "{{ client.system.page.url.pathname }}", "op": "MATCH_REGEX", "value": val}]

CLICK_WAIT = 0  # >0 makes Zaraz swallow+re-dispatch clicks -> double-fires menu toggle
SHIM_JS = (
    "try{(function(){function bind(){var b=document.querySelector('.im__send');"
    "var s=document.querySelector('input[data-im-subject]');"
    "if(b&&!b.__aoinBound){b.__aoinBound=1;"
    "b.addEventListener('click',function(){"
    "zaraz.track('inquiry_send',{subject:(s&&s.value)||''});});}}"
    "bind();document.addEventListener('astro:page-load',bind);})();}catch(e){}"
)

triggers, actions = {}, {}
for r in rows:
    tid = "aoin_%02d" % r["id"]
    sel, ev, params = r["selector"], r["event"], (r.get("params") or [])
    rules = page_rules(r["page"])
    if r["trigger"] == "click":
        rules = [{"id": "r%02dc" % r["id"], "action": "clickListener",
                  "settings": {"selector": sel, "type": "css", "waitForTags": CLICK_WAIT}}] + rules
    else:
        rules = [{"id": "r%02dv" % r["id"], "action": "elementVisibility",
                  "settings": {"selector": sel}}] + rules
    triggers[tid] = {"name": tid, "loadRules": rules}
    data = {"en": ev}
    for p in params:
        if p == "subject":
            continue  # DOM property -> shim path
        data[p] = "{{ client.%s }}" % p
    actions[tid] = {
        "actionType": "event",
        "blockingTriggers": [],
        "data": data,
        "enabled": True,
        "firingTriggers": [tid],
    }

# trigger 21: keep trigger (dashboard parity) but DROP its GA4 action (shim+AllTracks carries it)
actions.pop("aoin_21", None)
# shim delivered by Worker v3 inline script (custom-html Pageview delivery unreliable)

cfg = copy.deepcopy(BASE)
for k in ("probeClick", "probeVis"):
    cfg["triggers"].pop(k, None)
cfg["tools"].pop("probeTool", None)
cfg["tools"]["uGJK"]["actions"].pop("probeAct", None)
cfg["tools"].pop("aoin_shim", None)  # shim lives in Worker v3 (custom-html Pageview delivery is unreliable)
for tid, t in triggers.items():
    cfg["triggers"][tid] = t
for aid, a in actions.items():
    cfg["tools"]["uGJK"]["actions"][aid] = a

aoin_t = [t for t in cfg["triggers"] if t.startswith("aoin_")]
aoin_a = [a for a in cfg["tools"]["uGJK"]["actions"] if a.startswith("aoin_")]
assert len(aoin_t) == 25, len(aoin_t)
print("built: 25 triggers, %d GA4 actions (aoin_21 via shim+AllTracks), shim tool: %s"
      % (len(aoin_a), "aoin_shim" in cfg["tools"]))

if "--put" in sys.argv:
    st, d = api("PUT", "settings/zaraz/config", cfg)
    print("PUT ->", st, (d.get("errors") or "OK"))
    if st == 200:
        st2, live2 = api("GET", "settings/zaraz/config")
        json.dump(live2["result"], open("/tmp/zaraz-live-config.json", "w"), indent=1)
        tg = [t for t in live2["result"]["triggers"] if t.startswith("aoin_")]
        ac = [a for a in live2["result"]["tools"]["uGJK"]["actions"] if a.startswith("aoin_")]
        pr = [t for t in live2["result"]["triggers"] if t.startswith("probe")]
        print("live: %d aoin triggers, %d aoin actions, probes left: %s" % (len(tg), len(ac), pr or "none"))
else:
    json.dump(cfg, open("/tmp/zaraz-target-config.json", "w"), indent=1)
    print("dry-run: /tmp/zaraz-target-config.json")
