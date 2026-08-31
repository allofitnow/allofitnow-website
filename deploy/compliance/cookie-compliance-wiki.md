# 46009 Cookie Compliance - Reference

Source: Cookiebot "Legal Requirements for Websites: The 2026 Compliance Guide" (https://www.cookiebot.com/en/legal-requirements-for-websites/, published Jul 1, 2026; archived 2026-08-30).

Scope note: this wiki targets GDPR + ePrivacy (EU visitors) as the controlling regime for allofitnow.com (US-based, EU traffic possible), with CCPA/CPRA awareness. Laws apply by visitor location, not business registration.

## 1. The three legal pillars

| Pillar | Requirement | Key laws |
|---|---|---|
| Cookie consent | Informed, freely given, opt-in consent BEFORE non-essential cookies fire; equal "Accept"/"Reject"; no pre-ticked boxes | GDPR, ePrivacy Directive |
| Privacy policy | Published disclosure: what data, purposes, retention, sharing, rights | GDPR, CCPA/CPRA |
| Accessibility | WCAG 2.1 AA (keyboard nav, contrast 4.5:1, alt text, accessible forms); EAA enforcement since Jun 2025 | ADA, EAA / EN 301 549 |

## 2. Consent banner - what makes it legally valid

1. Block non-essential cookies until consent (banner alone is NOT sufficient)
2. Equal prominence and equal effort for Accept vs Reject (rejecting must not take more clicks)
3. No pre-ticked boxes, no steering language
4. Informed: categories, purposes, and who receives data, in clear language
5. Withdraw consent as easily as it was given (persistent re-open control)
6. Demonstrate consent: records with timestamps + audit trail

## 3. Dark patterns regulators act on (EDPB, CNIL, DPC)

- Accept more prominent than Reject, or Reject removed entirely
- Reject hidden behind "Manage Preferences" extra layer
- Pressure language framing rejection negatively

## 4. Mapping to 46009 today (audit 2026-08-30, re-audited 2026-08-31)

Current state (re-audited 2026-08-31, measured): NO consent banner of any kind; no privacy policy page (/privacy -> 404 live); alt text shipped (see srcset-ladder #62) but keyboard nav / contrast / focus states unaudited; no consent records. Tracking fires on the very first visit with zero consent, through THREE parallel vectors - all injected at ONE choke point, the worker `injectZaraz()` (v3f: ZARAZ_TAG + gtag + SHIM, idempotent, `deploy/zaraz-worker-fallback/worker.js`):

| # | Vector | What it does | Evidence (2026-08-31 cold-visit probe: headless Chromium, REAL_UA, clean profile) |
|---|---|---|---|
| 1 | Worker-injected gtag.js (G-1TVWRSCCLN prod / G-NDWE8QHK9W cutover) | Loads googletagmanager.com; fires page_view + inquiry_send + nav_menu_open (SHIM) | GET www.googletagmanager.com/gtag/js?id=G-1TVWRSCCLN on first load |
| 2 | Zaraz loader /cdn-cgi/zaraz/i.js -> s.js beacon | Ships document.cookie CONTENT, screen w/h/colorDepth, viewport, timezone offset, referrer, title, charset off-site (first-party endpoint) | s.js?z=<base64 payload> beacon fired pre-consent |
| 3 | Zaraz-managed GA4 tool (server-side Zaraz config) | Zaraz tool wrapper storing its own state cookies | cfz_google-analytics_v4 + cfzs_google-analytics_v4 set on first visit |

Cookies observed pre-consent - ALL are client-side document.cookie writes; ZERO Set-Cookie response headers, so header/caching layers cannot block them; only script-gating can:

| Cookie | Domain scope | Lifetime | Writer |
|---|---|---|---|
| _ga | .someofitlater.com | persistent | gtag.js |
| _ga_1TVWRSCCLN | .someofitlater.com | persistent | gtag.js |
| cfz_google-analytics_v4 | .someofitlater.com | persistent | Zaraz tool |
| cfzs_google-analytics_v4 | .someofitlater.com | session | Zaraz tool |

Network: exactly ONE GA4 collect beacon (google-analytics.com/g/collect, tid=G-1TVWRSCCLN) observed on first visit; attribution between vector 1 and vector 3 unverified (both were live simultaneously). Post-flip only vector 1 (worker-injected gtag) carries over to allofitnow.com with cookies scoped .allofitnow.com - vectors 2 and 3 are zone-Zaraz features of the 46009/someofitlater zone and disappear with the zone change (section 6). Cookie table above must be re-measured then. The Zaraz beacon shipping document.cookie content off-site is a disclosure item for the privacy policy (what leaves the browser, to whom).

Consequences for design (board 39, label `46009_cookie-compliance` - issues drafted 2026-08-31: gate #76, consent UI #77, privacy page #78, records v2 #79; wiki frozen as drafting source):
- GA4 tag loading MUST be consent-gated (this is the single highest-risk item: analytics fires pre-consent today)
- In opt-in jurisdictions the banner offers REJECT as the compliance-recommended default-FOCUS and equal option - NEVER "Accept all" as default; the owner's track-by-default preference is satisfied by the geo-split (default-on everywhere law permits, section 5)
- A minimal dialog CAN be compliant: 3 buttons, DO NOT TRACK-style reject as a first-class, equal-prominence default choice; "Accept" equally reachable in one click; per-category toggles available via a secondary "Customize" affordance (not required for first-level interaction)
- Privacy policy page must EXIST and disclose the measured surface: cookie table (both phases - .someofitlater.com today, .allofitnow.com post-flip), recipients (Google, Cloudflare), purposes, retention, withdrawal path (/privacy is 404 today; disclosure content per sections 4 and 8)

## 5. Consent UX - geo-split structure (owner rulings 2026-08-30 + 2026-08-31)

Owner preference (2026-08-31): track analytics BY DEFAULT wherever the law permits. GDPR/ePrivacy opt-in makes default-tracking unlawful for EU visitors, so the consent component ships as ONE unit with TWO behaviors, split by visitor geography (worker reads CF-IPCountry; gate predicate in section 6):

**Opt-in jurisdictions (EU/EEA/UK/CH):** centered BLOCKING modal on first visit - overlay obscures the page, dialog takes focus, user must choose before interacting. Focus trap per WCAG: initial focus on the reject action, keyboard reaches all three buttons, no focus escape to the page behind.

- **Default action: DO NOT TRACK (reject all)** - the compliance-recommended default; receives INITIAL KEYBOARD FOCUS (Enter = reject all); nothing non-essential fires before the choice. "Default" means focus order only, NEVER visual emphasis - reject and accept stay equal in size/style/prominence (emphasis asymmetry is the dark pattern regulators act on, section 3)
- **Button 2: Accept all** - equal size/style/prominence as reject (no color/weight tricks steering toward accept)
- **Button 3: Customize** - granular per-category panel (analytics on/off), one click from first level; rejecting from ANY level never requires more clicks than accepting

**Everywhere else (incl. US; notice regime):** analytics LIVE from first visit - no modal, no friction (the track-by-default preference, lawful here). Slim non-blocking notice line (analytics in use; link to privacy policy) + persistent footer "Cookie settings" control. Opt-out is ONE click from that control: writes analytics:false, purges _ga* cookies, strips gtag same-page - opt-out exactly as easy as the tracking was on (section 2 item 5).

Both planes: consent stored timestamped in the consent COOKIE - the authoritative store the worker gate reads (section 6); localStorage, if kept, a client-side cache only; consent cookie itself classified FUNCTIONAL (section 6-A). Neither the blocking modal nor the notice line re-presents after an explicit choice - the persistent footer "Cookie settings" control is the re-open path in both regimes (section 2 item 5); EU re-prompt cadence not required v1.

GA4 consequence: post-gate suppression is EU-ONLY - US/other traffic keeps flowing to GA4 untouched; expect a partial, not total, GA4 drop once the gate ships.

## 6. Consent gate mechanism (wiring the ruling to the worker - re-audited 2026-08-31)

The flow of record, made explicit. Same-page activation without navigation (step 5 below; fix B of the 2026-08-31 audit) is applied here as fact; the stale consent-mode posture on the Zaraz funnel wiki was superseded on that page (fix D). A (storage authority) and C (banner delivery plane) were flagged open and are now RESOLVED (owner, 2026-08-31) - rulings below; board-39 issues implement them. The geo-split consent UX and the post-Zaraz choice connection (owner rulings, 2026-08-31) are likewise settled mechanism below.

### Flow of record

user click (Reject all / Accept all / Customize / footer opt-out) -> client stores the choice -> worker reads CF-IPCountry + the consent cookie on every HTML response and gates the single choke point by jurisdiction.

1. Banner (worker-injected - decision C, resolved below) presents the section-5 UX for the visitor's jurisdiction: blocking modal in opt-in jurisdictions; notice line + footer opt-out elsewhere.
2. The choice handler writes the consent record.
3. `injectZaraz()` in the worker (v3f, `deploy/zaraz-worker-fallback/worker.js`) reads CF-IPCountry + the consent cookie from the incoming request and gates by JURISDICTION (geo-split, section 5): in opt-in jurisdictions (EU/EEA/UK/CH) tracking injects ONLY on an affirmative analytics opt-in - a missing, unparseable, or expired cookie and reject-all (analytics: false) ALL gate closed; everywhere else tracking injects BY DEFAULT (owner preference) and stops only on an explicit analytics:false. Failure of any kind reads as no consent, never the reverse; a missing/unknown CF-IPCountry itself reads as opt-in jurisdiction (geo fail-closed to the stricter regime). VPN/geo-miss residual (EU visitor via non-EU exit node gets notice-regime treatment) is an accepted risk - rides the board-39 issue. All three section-4 vectors sit behind this one function - skipping ZARAZ_TAG + gtag there gates the whole surface in one place. As-built this gate DOES NOT EXIST: the worker reads no cookies at all (grep cookie worker.js = zero hits, verified 2026-08-31).
4. Under the gate, first paint on a cold visit in OPT-IN jurisdictions serves ZERO tracking scripts: gtag never loads (no _ga* cookies), Zaraz tool never loads (no cfz* cookies). Nothing falls back to firing. In notice regimes first paint serves gtag by default (section 5 geo-split); the gate closes there only on explicit opt-out. (This is the gated end-state, not the present reality - section 4 documents today's ungated behavior.)
5. Activation on acceptance WITHOUT navigation (fix B): the banner's choice handler must ALSO inject the tracking scripts client-side at the moment of acceptance. Waiting for the next navigation is not acceptable - view transitions are live on 46009 (astro-view-transitions-enabled), so a user can accept and stay on the page for a whole session. The snippet the handler runs must be the SAME source the worker uses (single injection source, not a duplicated copy that can drift) - mechanically: the snippet is a SHARED MODULE imported by both the worker build and the banner handler - with decision C resolved to worker-injected, the module ships in the worker bundle and the banner handler runs it client-side.

### Owner decisions (resolved 2026-08-31)

- **A. Storage authority - RESOLVED (owner, 2026-08-31).** The consent cookie is the AUTHORITATIVE store (only the cookie is readable by the worker; localStorage, if kept, is a client-side cache). Cookie spec: `aoin_consent` = URL-encoded JSON {v, ts, categories{analytics: bool}}, SameSite=Lax, 1 year, host-only. Classification ruling: the consent cookie is FUNCTIONAL / strictly necessary (it stores the choice so the banner never re-shows; set only on explicit user action) - exempt from prior consent. GA4 repeat-visit MEASUREMENT cookies (_ga*) are NOT functional - they stay ANALYTICS behind the gate; classifying measurement as functional is the misclassification regulators test for. The worker gate treats a missing cookie as no-consent (gate closed; absence is the default, not an error) in OPT-IN jurisdictions; in notice regimes the missing cookie is the default-ON state per the owner's track-by-default preference - the cookie is only written there on an explicit choice - an opt-out or a settings-confirmed accept (section 6 step 3 is the operative jurisdiction-aware predicate).
- **C. Banner delivery plane - RESOLVED (owner, 2026-08-31): worker-injected.** Banner markup is injected by the worker at response time: consistent with how tracking is injected today, ships with worker deploys, satisfies step 5 same-source cleanly (one shared snippet module for worker + banner handler). Astro-build plane rejected: R2-cached markup drifts from worker changes between publishes and would push a duplicated client snippet.

### Consent records (v1 scope - ruled 2026-08-31)

Section 2 item 6 requires demonstrable consent: records with timestamps + audit trail. V1 scope ruling: the consent COOKIE IS the record - {v, ts, categories} (decision-A format, resolved 2026-08-31) carries the timestamp and granted categories, is re-readable at any time, and updates on every choice or withdrawal. Banner-version stamping and any durable audit trail beyond the cookie are OUT of v1; they ride board 39 as a drafted issue (decisions A and C resolved 2026-08-31 - the issues implement the rulings, they do not re-open them).

### Choice -> system connection (post-Zaraz stack; owner ruling 2026-08-31)

The choice connects to OUR stack - worker gate + GA4 - never to Zaraz. Zaraz receives no consent wiring: pre-flip the Zaraz vectors sit behind the same injectZaraz() choke-point gate (the skip kills them with everything else); post-flip Zaraz is off the new zone entirely (cutover ruling intact). Connection sequence on choice:

1. Handler writes the aoin_consent cookie (decision-A format).
2. Same-page activation via the shared module (step 5): inject gtag live on accept; strip gtag + purge _ga* cookies on opt-out.
3. gtag('consent', ...) BASIC Consent Mode v2 signals only - analytics_storage granted/denied with region-aware defaults matching the geo-split (denied in opt-in jurisdictions until choice; granted elsewhere until opt-out). No ads signals, no URL passthrough.
4. GA4 receives the consent state on every subsequent hit; the worker gate remains the enforcement layer (client signals alone are disclosure, not enforcement).

### Explicitly NOT the mechanism

- Zaraz consent mode / any Zaraz-side gating. Zaraz is NOT enabled on the allofitnow.com zone (cutover wiki: "Zaraz: NOT enabled on the new zone (Plan B injection is the delivery layer of record)"). The gate is worker-side only. Post-flip, vectors 2 and 3 (section 4) disappear with the zone change; vector 1 (gtag) remains the gated surface.

### Sequencing constraint (cross-sprint)

Gate deploy MUST come AFTER the #71 AC1 GA4 baseline capture (real publish, ~2h window): in opt-in jurisdictions the gate suppresses GA4 for non-consenting visitors (notice-regime traffic keeps flowing, section 5), and a gate-first deploy would still confound the pre/post-flip comparison the baseline anchors (the EU share of measurement shifts under the gate). Order: baseline capture -> gate deploy. Expected side effect: with the gate live, run-suite/launch-gate rows assuming unconditional gtag injection flip to expected-red until re-based - that re-base is a gate-issue task, not a wiki edit.

## 7. Enforcement snapshot (from source)

Regulators check function, not presence: cookies actually blocked pre-consent, choices honored, records producible. CNIL/DPC enforcement on banner design (dark patterns). EAA/EN 301 549 moving to WCAG 2.2 as best practice.

## 8. Out of scope (v1)

- TCF v2.3 / IAB framework registration (ad-tech specific; we run no programmatic ads)
- Consent Mode v2 Google CERTIFICATION + ads signals (revisit if GA4 ads features ever enabled). BASIC consent signals (analytics_storage granted/denied, region-aware defaults) are IN v1 scope - they are the choice-connection wire to GA4 (section 6, choice -> system connection); no certification is claimed
- US state-specific opt-out signals (Global Privacy Control) - CCPA applies only at scale thresholds; revisit at traffic milestones
- Cookie-scanning/declaration automation (Cookiebot-style third-party CMP) - we run exactly two tracking systems (worker-injected GA4 everywhere; Zaraz only pre-flip on the 46009 zone) with no ad-tech, so a hand-maintained cookie table in the privacy policy suffices. "First-party" applies to the cookie writers only, NOT the data recipients: gtag loads from googletagmanager.com and collects to google-analytics.com, and the Zaraz beacon ships to a Cloudflare endpoint (section 4) - all third parties the privacy policy must disclose.

## 9. Source fidelity

**Correction (2026-08-30 audit):** the repo snapshot `deploy/compliance/cookiebot-legal-requirements-2026-07.md` was NEVER committed - absent from the GitHub clone (all branches) and from `.245` working trees. This wiki page is the only surviving record of the 2026-07 legal-requirements capture; re-capture from the vendor site before drafting compliance issues.

**Update (2026-08-31):** a local mirror of this wiki exists at `deploy/compliance/cookie-compliance-wiki.md` in the /tmp/p46/repo working tree - UNTRACKED in git (never committed or pushed; /tmp is volatile), refreshed to match this page after each edit batch (byte size deliberately not pinned here; this page is the SSOT). Cookiebot source re-capture still owed.
