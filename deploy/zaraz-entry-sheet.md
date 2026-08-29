# Zaraz dashboard entry sheet (25 triggers, issue #32 Phase C)

Generated from deploy/tracking-dictionary.yaml (SSOT) 2026-08-29.
Zone someofitlater.com is ACTIVE; serving is behind the zone route
(worker v2, issue #50), so Zaraz injection will reach HTML once enabled.

## 0. Preconditions (in order)

1. Dashboard > Zaraz > Enable on zone someofitlater.com
2. GA4 forwarding BEFORE any trigger (playbook sec 1): measurement ID
   G-39QYRW6J7J, consent mode OFF, no debug flag
3. Create the ONE DOM variable first (needed by trigger 21):
   - type: DOM element, selector: input[data-im-subject],
     read attribute: value, name it im_subject

## 1. Triggers (enter in this order)

| # | Name | Type | Selector | Page rule | GA4 event + params |
|---|------|------|----------|-----------|--------------------|
| 1 | `aoin_01_carousel_project_click` | click | `.slide` | path equals / | carousel_project_click (title=element attribute data-title; slug=element attribute data-slug; caps=element attribute data-caps) |
| 2 | `aoin_02_cta_work_click` | click | `.work-cue` | path equals / | cta_work_click |
| 3 | `aoin_03_view_services` | visibility | `#services` | path equals / | view_services |
| 4 | `aoin_04_view_clients` | visibility | `.aoin-clients` | path equals / | view_clients |
| 5 | `aoin_05_view_footer` | visibility | `#contact` | path equals / | view_footer |
| 6 | `aoin_06_work_item_click` | click | `.tile` | path equals /work/ or /work | work_item_click (slug=element attribute data-slug; cap=element attribute data-cap; aria-label=element attribute aria-label) |
| 7 | `aoin_07_view_work_grid` | visibility | `#grid` | path equals /work/ or /work | view_work_grid |
| 8 | `aoin_08_view_work_list` | visibility | `[data-pane="list"]` | path equals /work/ or /work | view_work_list |
| 9 | `aoin_09_back_to_home` | click | `.back` | path equals /work/ or /work | back_to_home |
| 10 | `aoin_10_view_svc_realtime` | visibility | `#real-time-content` | path equals /services/ or /services | view_svc_realtime |
| 11 | `aoin_11_view_svc_screens` | visibility | `#screens-production` | path equals /services/ or /services | view_svc_screens |
| 12 | `aoin_12_view_svc_mixed` | visibility | `#mixed-reality` | path equals /services/ or /services | view_svc_mixed |
| 13 | `aoin_13_view_svc_equipment` | visibility | `#equipment-rental` | path equals /services/ or /services | view_svc_equipment |
| 14 | `aoin_14_view_studio_statement` | visibility | `.statement` | path equals /studio/ or /studio | view_studio_statement |
| 15 | `aoin_15_view_studio_team` | visibility | `.team` | path equals /studio/ or /studio | view_studio_team |
| 16 | `aoin_16_view_project_gallery` | visibility | `.pp__gallery` | path equals /work/*/ or /work/* | view_project_gallery |
| 17 | `aoin_17_view_project_stats` | visibility | `.pp__stats` | path equals /work/*/ or /work/* | view_project_stats |
| 18 | `aoin_18_view_project_credits` | visibility | `.pp__credits` | path equals /work/*/ or /work/* | view_project_credits |
| 19 | `aoin_19_project_next_click` | click | `a[href^="/work/"]:not(.tile):not(.slide)` | path equals /work/*/ or /work/* | project_next_click (href=element attribute href) |
| 20 | `aoin_20_inquiry_open` | visibility | `.im__panel` | no page condition | inquiry_open |
| 21 | `aoin_21_inquiry_send` | click | `.im__send` | no page condition | inquiry_send (subject={{im_subject}}) |
| 22 | `aoin_22_inquiry_close` | click | `.im__close` | no page condition | inquiry_close |
| 23 | `aoin_23_nav_menu_open` | click | `.aoin-nav__menu-btn` | no page condition | nav_menu_open |
| 24 | `aoin_24_nav_home_click` | click | `a[data-aoin-logo]` | no page condition | nav_home_click |
| 25 | `aoin_25_back_to_work` | click | `.pbar__icon` | path equals /work/*/ or /work/* | back_to_work |

## 2. Entry rules (all triggers)

- Click triggers: fire on descendant clicks (dashboard default).
- Visibility triggers: enter-viewport, threshold 50% (default).
- data-caps vs data-cap singular mismatch is REAL markup; do not normalize.
- Row 20 selector .im__panel sits inside a <dialog>; enter as normal
  Visibility now; top-layer behavior is an M3 assert, not an entry change.

## 3. After entry (same session, then hand back to agent)

1. Dashboard JSON export -> deploy/zaraz-export-<date>.json (commit)
2. Agent runs: injection check (script tag in live HTML), M2 25/25
   presence check, M3 bring-up asserts
3. E2E walk per note 14918 with ?_zaraz_debug (HITL-gated send
   marker subject GA4E2E-<epoch>)

## 4. Pre-entry validation (2026-08-29, agent-run)

All 25 selectors validated against LIVE DOM (post-worker launch, all pages
fetched from 46009.someofitlater.com edge, lxml cssselect):

- 25/25 selectors matched. Zero missing. Zero malformed.
- Notable counts: .slide x24 on /, .tile x23 on /work/
- "all"-page selectors (im__panel/im__send/im__close, nav btn, logo,
  input[data-im-subject]) present on every probed page (5/5) - the inquiry
  modal IS server-rendered; dialog top-layer is a visibility nuance only.
- Evidence: /tmp/domcheck/report.txt (session) - re-run via the dictionary
  + lxml cssselect on any page fetch.

Entry can proceed with zero selector risk.
