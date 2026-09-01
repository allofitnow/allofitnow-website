// #76 + #77 unit tests (node:test). Run: node --test test/
import { test } from "node:test";
import assert from "node:assert/strict";
import { OPT_IN, parseConsent, isOptIn, gateOpen } from "../src/gate.mjs";
import { bannerFor } from "../src/banner.mjs";
import { loaderScriptTag, consentDefaultJs, gtagInitJs, acceptHandlerJs, optOutHandlerJs, acceptBodyJs, optOutBodyJs } from "../src/inject-snippet.mjs";

const CONSENT_OFF = 'aoin_consent=' + encodeURIComponent(JSON.stringify({ v: 1, ts: 1, categories: { analytics: false } }));
const CONSENT_ON = 'aoin_consent=' + encodeURIComponent(JSON.stringify({ v: 1, ts: 1, categories: { analytics: true } }));

// ---- #76 gate predicate (10 spec cases) ----

test("US cold, no cookie -> gate OPEN (default-ON)", () => {
  assert.equal(gateOpen("US", null), true);
});

test("US explicit opt-out -> closed", () => {
  assert.equal(gateOpen("US", CONSENT_OFF), false);
});

test("US settings-accept -> open", () => {
  assert.equal(gateOpen("US", CONSENT_ON), true);
});

test("GB cold, no cookie -> CLOSED (opt-in regime)", () => {
  assert.equal(gateOpen("GB", null), false);
});

test("GB accept -> open", () => {
  assert.equal(gateOpen("GB", CONSENT_ON), true);
});

test("GB reject -> closed", () => {
  assert.equal(gateOpen("GB", CONSENT_OFF), false);
});

test("unknown country cold -> closed (fail closed)", () => {
  assert.equal(gateOpen("", null), false);
});

test("null country cold -> closed", () => {
  assert.equal(gateOpen(null, null), false);
});

test("DE garbage cookie -> closed", () => {
  assert.equal(gateOpen("DE", "aoin_consent=not-json"), false);
});

test("FR expired/browser-dropped -> closed", () => {
  assert.equal(gateOpen("FR", null), false);
});

test("lowercase country codes normalized", () => {
  assert.equal(isOptIn("de"), true);
  assert.equal(isOptIn("us"), false);
});

test("OPT_IN set matches wiki list (32)", () => {
  assert.equal(OPT_IN.size, 32);
});

// ---- #77 banner plane selection ----

test("bannerFor US -> notice (no modal, footer settings present)", () => {
  const b = bannerFor("US", "G-TEST", null);
  assert.equal(b.kind, "notice");
  assert.ok(b.html.includes("aoin-cs-notice"));
  // no LIVE modal markup (the re-open copy is an escaped JS string, fine)
  assert.ok(!b.html.includes('<div id="aoin-cs-overlay"'));
  assert.ok(b.html.includes("aoin-cs-reopen"));
});

test("bannerFor GB -> modal (blocking, 3 buttons, panel)", () => {
  const b = bannerFor("GB", "G-TEST", null);
  assert.equal(b.kind, "modal");
  assert.ok(b.html.includes("aoin-cs-overlay"));
  assert.ok(b.html.includes("aoin-cs-reject"));
  assert.ok(b.html.includes("aoin-cs-accept"));
  assert.ok(b.html.includes("aoin-cs-customize"));
  assert.ok(b.html.includes("aoin-cs-panel"));
});

test("bannerFor unknown/empty country -> modal (fail closed)", () => {
  assert.equal(bannerFor("", "G-TEST", null).kind, "modal");
  assert.equal(bannerFor(null, "G-TEST", null).kind, "modal");
});

test("bannerFor with choice already recorded -> settled (no re-presentation)", () => {
  for (const ck of [CONSENT_ON, CONSENT_OFF]) {
    const b = bannerFor("US", "G-TEST", ck);
    assert.equal(b.kind, "settled");
    assert.ok(!b.html.includes('<div id="aoin-cs-overlay"'));
    assert.ok(!b.html.includes('<div id="aoin-cs-notice"'));
    assert.ok(b.html.includes("aoin-cs-reopen")); // footer re-open path
  }
});

test("notice plane: opt-out link present, /privacy linked", () => {
  const b = bannerFor("US", "G-TEST", null);
  assert.ok(b.html.includes("aoin-cs-out"));
  assert.ok(b.html.includes('href="/privacy"'));
});

test("modal plane: no pre-ticked boxes beyond analytics default checkbox state clarity", () => {
  const b = bannerFor("GB", "G-TEST", null);
  // customize panel checkbox starts CHECKED=false? spec: no pre-ticked boxes.
  assert.ok(!/type="checkbox" checked/.test(b.html));
});

// ---- shared snippet module ----

test("consent default: opt-in -> denied, notice -> granted", () => {
  assert.ok(consentDefaultJs("GB").includes("analytics_storage:'denied'"));
  assert.ok(consentDefaultJs("US").includes("analytics_storage:'granted'"));
});

test("accept handler is idempotent + injects loader + grants", () => {
  const js = acceptHandlerJs("G-TEST");
  assert.ok(js.includes("__aoinGtagOn"));
  assert.ok(js.includes("googletagmanager.com/gtag/js?id=G-TEST"));
  assert.ok(js.includes("analytics_storage:'granted'"));
});

test("banner runtime composes the shared module bodies (same-source)", () => {
  // runtimeJs is module-private; observable contract: bannerFor output embeds
  // the SAME acceptBodyJs/optOutBodyJs text the shared module exports.
  const b = bannerFor("US", "G-TEST", null);
  const acceptFrag = acceptBodyJs("G-TEST");
  const optFrag = optOutBodyJs();
  assert.ok(b.html.includes(acceptFrag));
  assert.ok(b.html.includes(optFrag));
});

test("opt-out handler purges _ga + denies + strips scripts", () => {
  ga4id_deopt_checks: {
    const js = optOutHandlerJs("G-TEST");
    assert.ok(js.includes("/^_ga/"));
    assert.ok(js.includes("analytics_storage:'denied'"));
    assert.ok(js.includes("googletagmanager.com"));
  }
});

test("gtagInitJs wires config after consent default", () => {
  const js = gtagInitJs("G-X", "GB");
  assert.ok(js.indexOf("consent") < js.indexOf("config"));
});
