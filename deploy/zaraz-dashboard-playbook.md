# Zaraz dashboard creation playbook (pre-ACTIVE prep, Phase C)

Status: DRAFT for execution once the zone is ACTIVE and the R2 custom domain
is attached. The dashboard is the only write surface on this plan (no config
API); this playbook makes entry mechanical. Machine SSOT for WHAT should
exist: deploy/tracking-dictionary.yaml (issue #44, closed). This playbook for
HOW to enter it. After entry, the export snapshot records what DOES exist.

## 0. Preconditions (do not start until all true)

1. Zone someofitlater.com ACTIVE (NS flip done; Phase D, user manual step)
2. R2 bucket 46009 custom domain attached (46009.someofitlater.com)
3. Zaraz enabled on the zone (dashboard > Zaraz > Enable)
4. GA4 forwarding settings below applied BEFORE any trigger is created

## 1. GA4 forwarding settings (spec closed 2026-08-27, wiki L236-241)

| Setting | Value |
|---|---|
| Measurement ID | G-1TVWRSCCLN (stream 15524204247, property 552018344; repointed 2026-08-29 per #52; G-39QYRW6J7J (archived)) |
| Consent mode | OFF this phase |
| Debug flag | ?_zaraz_debug during E2E walk only |

GA4 custom dimensions (event-scoped) already registered 2026-08-27 via Admin
API: subject, slug, title, client. They activate on first event carrying each
param. No dashboard action needed; listed here as a cross-check only.

## 2. Trigger creation order (rows 1-25, in order)

Naming: aoin_<row-zero-padded-2>_<event>. Example: aoin_06_work_item_click.
Type = Click or Visibility per the dictionary. Selector = dictionary value.
GA4 action = event name + params from the dictionary row.

Rules for every trigger:
- Click triggers: fire on descendant clicks (dashboard default) so hits on
  inner elements register.
- Visibility triggers: enter-viewport, threshold 50% (dashboard default);
  tune only if M3 bring-up shows flakiness; any tune = Tier-3 change +
  dictionary note.
- Page scope: use the dictionary page glob translated to a path rule:
  "/" = path equals /
  "/work/" = path equals /work/ or /work
  "/work/*/" = path starts with /work/ AND path is deeper than /work/
  "all" = no page condition
- Carousel rows (1): the selector matches mirror clones; dedupe is handled by
  Zaraz's per-element trigger semantics and verified in M3 bring-up (assert:
  exactly one event per physical click). Do not add custom dedupe now.

Per-row entry values: read directly from deploy/tracking-dictionary.yaml
(verbatim selectors and params; data-caps vs data-cap singular mismatch is
REAL markup, do not normalize). The wiki table (Cloudflare Zaraz Tracking GA4
Funnel Exploration, L64-90) is the confirmed human snapshot; dictionary wins
on any divergence.

Special cases:
- Row 19: selector a[href^="/work/"]:not(.tile):not(.slide) - matches exactly
  the ProjectBar NEXT anchor in the current build.
- Row 21: create a Zaraz DOM variable first:
    type: DOM element, selector input[data-im-subject], read attribute value
  then wire it into the trigger action param subject.
- Row 20: .im__panel sits inside a <dialog>; top-layer visibility behavior is
  an M3 bring-up assert; enter as a normal Visibility trigger now.
- Row 25: .pbar__icon (data-pbar-hot="work").

## 3. After entry (same session)

1. Export snapshot: dashboard JSON export -> deploy/zaraz-export-<date>.json
   (commit to this repo; diff vs previous in the drift ledger)
2. Run M2 presence check against the live custom domain (dictionary vs
   served DOM) - expect 25/25 PASS
3. M3 bring-up asserts (sandbox first): view_work_list NOT firing on initial
  /work/ load; carousel dedupe (1 event per click); dialog top-layer fires.
4. Then the E2E walk per note 14918 with ?_zaraz_debug (HITL-gated; the real
  inquiry_send uses marker subject GA4E2E-<epoch>).

## 4. Injection gate (decision point #32 Phase C)

After triggers are in: load 46009.someofitlater.com and check the Zaraz
script tag is present in the HTML response. If absent (R2 custom domain may
not get auto-injection), fallback = Worker in front of the bucket (production
wiki sec 7 gate). Do not build the Worker preemptively; it is a documented
fallback only.

## Change control

- Any selector/event change after this entry = Tier 3: HITL gate, update the
  dictionary yaml FIRST, then dashboard, then re-export snapshot + M2 re-run.
- This playbook itself mirrors the dictionary at commit time; on dictionary
  drift, regenerate the per-row section from the yaml.
