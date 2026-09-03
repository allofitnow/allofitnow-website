// test/contact.test.mjs — unit suite for src/contact.mjs (#112)
// Run: node --test test/contact.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateFields,
  bucketKeys,
  sesPayload,
  sesSend,
  handleContact,
  sanitizeFilename,
  vetFiles,
  buildRawMime,
} from "../src/contact.mjs";

// ---- fixtures ------------------------------------------------------------

const GOOD = {
  name: "Howard Wong",
  email: "howard@example.com",
  message: "Hello, this is a message of adequate length.",
  topic: "general",
  company: "",
  elapsed: 3000,
  cf_turnstile: "tok123",
};

function req(overrides = {}, init = {}) {
  const body = JSON.stringify({ ...GOOD, ...overrides });
  return new Request("https://allofitnow.com/api/contact", {
    method: "POST",
    body,
    headers: { "content-length": String(body.length), ...init.headers },
  });
}

class FakeKV {
  constructor() { this.m = new Map(); }
  async get(k) { return this.m.has(k) ? this.m.get(k) : null; }
  async put(k, v, opts) { this.m.set(k, v); this.opts = opts; }
}

const mkEnv = (kv, e2e = false) => ({
  CONTACT_KV: kv,
  HASH_SALT: "testsalt",
  TURNSTILE_SECRET: "unit-secret",
  SES_KEY: "AKIAUNITTEST",
  SES_SECRET: "unitsecret",
});

const okFetchers = {
  doh: async () => ({ ok: true, json: async () => ({ Status: 0, Answer: [{ name: "example.com", type: 15, data: "10 mail.example.com" }] }) }),
  turnstile: async () => ({ ok: true, json: async () => ({ success: true }) }),
  ses: async () => ({ ok: true, json: async () => ({ MessageId: "unit-1" }) }),
};
const sesFailFetchers = { ...okFetchers, ses: async () => ({ ok: false, status: 500, json: async () => ({}) }) };
const tsFailFetchers = { ...okFetchers, turnstile: async () => ({ ok: true, json: async () => ({ success: false }) }) };
const mxNullFetchers = { ...okFetchers, doh: async () => ({ ok: true, json: async () => ({ Status: 0, Answer: [{ name: "bad.test", type: 15, data: "0 ." }] }) }) };
const mxMissingFetchers = { ...okFetchers, doh: async () => ({ ok: true, json: async () => ({ Status: 0, Answer: [] }) }) };

// ---- L0: shape -----------------------------------------------------------

test("accepts a valid payload", () => {
  const v = validateFields(JSON.parse(JSON.stringify(GOOD)));
  assert.ok(v);
  assert.equal(v.email, "howard@example.com");
});

test("rejects: name missing/too long, bad email, short message, bad topic", () => {
  assert.equal(validateFields({ ...GOOD, name: "" }), null);
  assert.equal(validateFields({ ...GOOD, name: "x".repeat(81) }), null);
  assert.equal(validateFields({ ...GOOD, email: "nope" }), null);
  assert.equal(validateFields({ ...GOOD, message: "too short" }), null);
  assert.equal(validateFields({ ...GOOD, topic: "spam" }), null);
});

test("L1 rejects filled honeypot and out-of-bounds elapsed", () => {
  assert.equal(validateFields({ ...GOOD, company: "spamco" }), null);
  assert.equal(validateFields({ ...GOOD, elapsed: 2499 }), null); // below floor
  assert.ok(validateFields({ ...GOOD, elapsed: 2500 })); // exactly floor: valid (spec: >= 2500ms)
  assert.ok(validateFields({ ...GOOD, elapsed: 2501 }));
  assert.equal(validateFields({ ...GOOD, elapsed: 24 * 3600e3 + 1 }), null); // over 24h cap
});

test("missing/absent company field is fine (undefined ok)", () => {
  const g = { ...GOOD };
  delete g.company;
  assert.ok(validateFields(g));
});

test("missing turnstile token rejected", () => {
  assert.equal(validateFields({ ...GOOD, cf_turnstile: "" }), null);
  const g = { ...GOOD };
  delete g.cf_turnstile;
  assert.equal(validateFields(g), null);
});

// ---- L3: rate limit ------------------------------------------------------

test("6th request in same hour from same IP is 429 with Retry-After", async () => {
  const kv = new FakeKV();
  for (let i = 0; i < 5; i++) {
    // vary email per request: isolates the per-IP hour limit (5) from the
    // per-email hour limit (3)
    const r = await handleContact(req({ email: `u${i}@example.com` }), mkEnv(kv), okFetchers);
    assert.equal(r.status, 202);
  }
  const r6 = await handleContact(req({ email: "u9@example.com" }), mkEnv(kv), okFetchers);
  assert.equal(r6.status, 429);
  assert.equal(JSON.parse(await r6.text()).error, "rate_limited");
  assert.ok(parseInt(r6.headers.get("retry-after"), 10) > 0);
});

test("4th request in same hour for same email (different IP) is 429", async () => {
  const kv = new FakeKV();
  for (let i = 0; i < 3; i++) {
    const r = await handleContact(req({}, { headers: { "cf-connecting-ip": `10.0.0.${i + 1}` } }), mkEnv(kv), okFetchers);
    assert.equal(r.status, 202);
  }
  const r4 = await handleContact(req({}, { headers: { "cf-connecting-ip": "10.0.0.9" } }), mkEnv(kv), okFetchers);
  assert.equal(r4.status, 429);
});

// ---- L2: MX --------------------------------------------------------------

test("null-MX sender domain rejected", async () => {
  const kv = new FakeKV();
  const r = await handleContact(req({ email: "x@bad.test" }, { headers: { "cf-connecting-ip": "10.1.0.1" } }), mkEnv(kv), mxNullFetchers);
  assert.equal(r.status, 400);
});

test("no-MX sender domain rejected; cached negative", async () => {
  const kv = new FakeKV();
  const r = await handleContact(req({ email: "x@bad.test" }, { headers: { "cf-connecting-ip": "10.1.0.2" } }), mkEnv(kv), mxMissingFetchers);
  assert.equal(r.status, 400);
  assert.equal(await kv.get("mx:bad.test"), "0");
});

test("MX ok passes; positive cached", async () => {
  const kv = new FakeKV();
  const r = await handleContact(req({}, { headers: { "cf-connecting-ip": "10.1.0.3" } }), mkEnv(kv), okFetchers);
  assert.equal(r.status, 202);
  assert.equal(await kv.get("mx:example.com"), "1");
});

// ---- L4: Turnstile -------------------------------------------------------

test("Turnstile fail -> 400 (fail-closed)", async () => {
  const kv = new FakeKV();
  const r = await handleContact(req({}, { headers: { "cf-connecting-ip": "10.2.0.1" } }), mkEnv(kv), tsFailFetchers);
  assert.equal(r.status, 400);
});

// ---- send + E2E ----------------------------------------------------------

test("SES success -> 202 {ok:true}", async () => {
  const kv = new FakeKV();
  const r = await handleContact(req({}, { headers: { "cf-connecting-ip": "10.3.0.1" } }), mkEnv(kv), okFetchers);
  assert.equal(r.status, 202);
  assert.equal(JSON.parse(await r.text()).ok, true);
});

test("SES failure -> 502 {ok:false,error:upstream}", async () => {
  const kv = new FakeKV();
  const r = await handleContact(req({}, { headers: { "cf-connecting-ip": "10.3.0.2" } }), mkEnv(kv), sesFailFetchers);
  assert.equal(r.status, 502);
  assert.equal(JSON.parse(await r.text()).error, "upstream");
});

test("E2E header -> 202 {ok:true,e2e:{payload}} and no SES send", async () => {
  const kv = new FakeKV();
  let sesCalled = 0;
  const fx = { ...okFetchers, ses: async () => { sesCalled++; return { ok: true, json: async () => ({}) }; } };
  const r = await handleContact(req({}, { headers: { "x-aoin-e2e": "1", "cf-connecting-ip": "10.3.0.3" } }), mkEnv(kv), fx);
  assert.equal(r.status, 202);
  const body = JSON.parse(await r.text());
  assert.equal(body.ok, true);
  assert.ok(body.e2e.payload.FromEmailAddress === '"AOIN Website" <support@allofitnow.com>');
  assert.ok(body.e2e.payload.Destination.ToAddresses[0] === "info@allofitnow.com");
  assert.equal(sesCalled, 0);
});

test("E2E header sits behind the rate limiter", async () => {
  const kv = new FakeKV();
  for (let i = 0; i < 5; i++) {
    const r = await handleContact(req({ email: `e2e${i}@example.com` }, { headers: { "x-aoin-e2e": "1", "cf-connecting-ip": "10.3.0.4" } }), mkEnv(kv), okFetchers);
    assert.equal(r.status, 202);
  }
  const r6 = await handleContact(req({ email: "e2e9@example.com" }, { headers: { "x-aoin-e2e": "1", "cf-connecting-ip": "10.3.0.4" } }), mkEnv(kv), okFetchers);
  assert.equal(r6.status, 429);
});

// ---- 413 -----------------------------------------------------------------

test("content-length over cap -> 413 before parse", async () => {
  const r = await handleContact(req({}, { headers: { "content-length": "20000" } }), mkEnv(new FakeKV()), okFetchers);
  assert.equal(r.status, 413);
});

// ---- SES payload + signatures -------------------------------------------

test("sesPayload: display-name From, formatted ReplyTo, template body (v3p)", () => {
  const mk = (topic) =>
    sesPayload(validateFields({ ...JSON.parse(JSON.stringify(GOOD)), topic }));
  const cases = {
    general: "info@allofitnow.com",
    rentals: "rentals@allofitnow.com",
    careers: "careers@allofitnow.com",
  };
  for (const [topic, to] of Object.entries(cases)) {
    const p = mk(topic);
    assert.equal(p.FromEmailAddress, '"AOIN Website" <support@allofitnow.com>');
    assert.deepEqual(p.ReplyToAddresses, ['"Howard Wong" <howard@example.com>']);
    assert.deepEqual(p.Destination.ToAddresses, [to]);
    assert.ok(p.Content.Simple.Subject.Data.startsWith(`[AOIN/${topic}]`));
    const body = p.Content.Simple.Body.Text.Data;
    assert.ok(body.includes(`[AOIN/${topic.toUpperCase()}] WEBSITE INQUIRY`));
    assert.ok(body.includes("Name:    Howard Wong"));
    assert.ok(body.includes("Email:   howard@example.com"));
    assert.ok(body.includes(GOOD.message));
    assert.ok(body.endsWith("Sent via the allofitnow.com contact form. Reply directly to respond."));
  }
  // Header-injection attempt: quotes/CR/LN stripped from the display name.
  const evil = validateFields({ ...JSON.parse(JSON.stringify(GOOD)), name: 'Bad" <x@y>, \r\nBcc: evil@z' });
  const rt = sesPayload(evil).ReplyToAddresses[0];
  assert.ok(!/[\r\n]/.test(rt));
  assert.ok(rt.startsWith('"Bad'));
  // Unknown topic is 400'd by validateFields (returns null), so it can't reach
  // sesPayload in prod — but the builder still fails safe to the general inbox.
  const safe = validateFields(JSON.parse(JSON.stringify(GOOD)));
  assert.deepEqual(
    sesPayload({ ...safe, topic: "nope" }).Destination.ToAddresses,
    ["info@allofitnow.com"]);
});

test("bucketKeys: fixed UTC hour/day buckets", () => {
  const k = bucketKeys(Date.UTC(2026, 8, 3, 12, 30, 0));
  assert.equal(k.hour, Math.floor(Date.UTC(2026, 8, 3, 12, 30) / 3600000));
  assert.equal(k.day, Math.floor(Date.UTC(2026, 8, 3, 12, 30) / 86400000));
});

test("sesSend: real SigV4 round-trip against moto-like stub (signature shape)", async () => {
  // stub captures headers; verifies deterministic signature pipeline runs
  let captured = null;
  const stub = async (url, init) => {
    captured = { url, init };
    return { ok: true, json: async () => ({ MessageId: "m" }) };
  };
  await sesSend(sesPayload(validateFields(JSON.parse(JSON.stringify(GOOD)))), "AKIAUNIT", "unitsecret", stub);
  assert.ok(captured.init.headers.authorization.startsWith("AWS4-HMAC-SHA256 Credential=AKIAUNIT/"));
  assert.ok(captured.url.includes("email.us-east-1.amazonaws.com"));
});

// ---- #125: attachments ---------------------------------------------------

test("sanitizeFilename: basename, control chars, empties", () => {
  assert.equal(sanitizeFilename("../../etc/passwd"), "passwd");
  assert.equal(sanitizeFilename('C:\\Users\\h\\evil".exe'), "evil.exe"); // basename first, quote stripped
  assert.equal(sanitizeFilename("   "), "attachment");
  assert.equal(sanitizeFilename("résumé.pdf"), "résumé.pdf");
});

test("vetFiles: count/ext/size gates", () => {
  const f = (name, size) => ({ name, size });
  assert.equal(vetFiles([]).length, 0);
  assert.equal(vetFiles(null).length, 0);
  assert.ok(vetFiles([f("a.pdf", 100)]));
  assert.equal(vetFiles([f("a.pdf", 100), f("b.png", 100), f("c.mov", 100), f("d.jpg", 100)]), null); // >3
  assert.equal(vetFiles([f("a.exe", 100)]), null);      // bad ext
  assert.equal(vetFiles([f("a.pdf", 0)]), null);        // empty file
  assert.equal(vetFiles([f("a.pdf", 26 * 1024 * 1024)]), null); // per/total cap
});

test("buildRawMime: multipart/mixed structure + base64 attachment", async () => {
  const v = validateFields(JSON.parse(JSON.stringify(GOOD)));
  const raw = atob(await buildRawMime(v, [{ name: "spec.pdf", bytes: new TextEncoder().encode("%PDF-1.4 test") }]));
  assert.ok(raw.includes("Content-Type: multipart/mixed;"));
  assert.ok(raw.includes('From: "AOIN Knowledge" <support@allofitnow.com>') || raw.includes('From: "AOIN Website" <support@allofitnow.com>'));
  assert.ok(raw.includes('filename="spec.pdf"'));
  assert.ok(raw.includes("JVBERi0")); // %PDF base64 prefix
  assert.ok(raw.includes("Content-Type: text/plain;"));
  assert.ok(raw.endsWith("--" + raw.match(/boundary="([^"]+)"/)[1] + "--\r\n"));
});

function multipartReq(fd, ip) {
  const enc2 = new Response(fd); // sets content-type w/ REAL boundary
  return new Request("https://allofitnow.com/api/contact", {
    method: "POST",
    body: enc2.body,
    duplex: "half", // node stream body
    headers: {
      "content-type": enc2.headers.get("content-type"),
      "x-aoin-e2e": "1",
      "cf-connecting-ip": ip,
    },
  });
}
test("multipart intake: valid files accepted, e2e returns Raw + metadata", async () => {
  const fd = new FormData();
  for (const [k, val] of Object.entries(GOOD)) fd.append(k, String(val));
  fd.append("files", new File(["%PDF-1.4 attachment test"], "pitch.pdf", { type: "application/pdf" }));
  const r = await handleContact(multipartReq(fd, "10.4.0.1"), mkEnv(new FakeKV()), okFetchers);
  assert.equal(r.status, 202);
  const j = JSON.parse(await r.text());
  assert.ok(j.e2e.payload.Content.Raw, "Raw MIME payload expected");
  const mime = atob(j.e2e.payload.Content.Raw.Data);
  assert.ok(mime.includes('filename="pitch.pdf"'));
  assert.deepEqual(j.e2e.attachments, [{ name: "pitch.pdf", size: 24, type: "application/pdf" }]);
});

test("multipart intake: exe + oversize rejected with 400", async () => {
  const mk = async (fname, content) => {
    const fd = new FormData();
    for (const [k, val] of Object.entries(GOOD)) fd.append(k, String(val));
    fd.append("files", new File([content], fname, { type: "application/x-msdownload" }));
    return handleContact(multipartReq(fd, "10.4.0.2"), mkEnv(new FakeKV()), okFetchers);
  };
  assert.equal((await mk("evil.exe", "MZ")).status, 400);
  // 25.5MB passes the (absent-in-node) upload gate but fails the 25MB total vet -> 400
  const fat = new Uint8Array(25 * 1024 * 1024 + 512 * 1024);
  assert.equal((await mk("fat.pdf", fat)).status, 400);
  // 26MB upload with content-length declared -> 413 upload gate (browser path)
  {
    const fd = new FormData();
    for (const [k, val] of Object.entries(GOOD)) fd.append(k, String(val));
    fd.append("files", new File([new Uint8Array(26 * 1024 * 1024)], "big.pdf"));
    const enc2 = new Response(fd);
    const text = await enc2.text();
    const r = await handleContact(new Request("https://allofitnow.com/api/contact", {
      method: "POST",
      body: text,
      headers: {
        "content-type": enc2.headers.get("content-type"),
        "x-aoin-e2e": "1",
        "cf-connecting-ip": "10.4.0.3",
        "content-length": String(text.length),
      },
    }), mkEnv(new FakeKV()), okFetchers);
    assert.equal(r.status, 413);
  }
});
