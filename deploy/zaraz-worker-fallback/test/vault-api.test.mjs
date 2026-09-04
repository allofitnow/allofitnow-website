// test/vault-api.test.mjs — unit suite for src/vault-api.mjs (#130 v4 step A + abort).
// Run: node --test test/vault-api.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { handleVaultSession, handleVaultAbort } from "../src/vault-api.mjs";

// ---- fixtures ------------------------------------------------------------

class FakeKV {
  constructor() { this.m = new Map(); }
  async get(k) { return this.m.get(k) ?? null; }
  async put(k, v, _o) { this.m.set(k, String(v)); }
  async delete(k) { this.m.delete(k); }
}

const ORIGIN = "https://allofitnow.com";
const CS = "11111111-2222-3333-4444-555555555555";

function mkEnv(kv) {
  return {
    CONTACT_KV: kv,
    HASH_SALT: "s",
    TURNSTILE_E2E_SECRET: "1x0000000000000000000000000000000AA",
  };
}

// e2e-mode fetchers: siteverify doubles as the test-secret dummy that always
// succeeds (matches contact.test.mjs's okFetchers pattern); Drive unused in e2e.
const okFx = {
  turnstile: async () => new Response(JSON.stringify({ success: true }), { status: 200 }),
  drive: async () => { throw new Error("drive must not be called in e2e mode"); },
};

function req(body, opts = {}) {
  return new Request("https://allofitnow.com/api/vault/session", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: ORIGIN,
      "x-aoin-e2e": "1",
      "cf-connecting-ip": opts.ip || "10.9.0.1",
      cookie: "aoin_cs=" + (opts.cs || CS),
      ...(opts.headers || {}),
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const FILES = [{ name: "pitch.pdf", size: 24 }];

// ---- A: happy path (e2e) ---------------------------------------------------

test("A e2e: origin+cookie+turnstile+vet ok -> 202 with stamped files + total", async () => {
  const r = await handleVaultSession(
    req({ files: FILES, turnstile: "tok" }), mkEnv(new FakeKV()), okFx);
  assert.equal(r.status, 202);
  const j = JSON.parse(await r.text());
  assert.ok(j.ok);
  assert.equal(j.e2e.totalBytes, 24);
  assert.match(j.e2e.files[0].name, /^\d{8}-\d{6}_pitch\.pdf$/);
});

// ---- A: gates ---------------------------------------------------------------

test("A: wrong origin -> 403 origin", async () => {
  const r = await handleVaultSession(
    req({ files: FILES, turnstile: "tok" }, { headers: { origin: "https://evil.example" } }),
    mkEnv(new FakeKV()), okFx);
  assert.equal(r.status, 403);
  assert.equal(JSON.parse(await r.text()).error, "origin");
});

test("A: missing aoin_cs cookie -> 400 session", async () => {
  const r = await handleVaultSession(
    req({ files: FILES, turnstile: "tok" }, { headers: { cookie: "" } }),
    mkEnv(new FakeKV()), okFx);
  assert.equal(r.status, 400);
  assert.equal(JSON.parse(await r.text()).error, "session");
});

test("A: bad declaration (.exe) -> 400 validation", async () => {
  const r = await handleVaultSession(
    req({ files: [{ name: "evil.exe", size: 5 }], turnstile: "tok" }),
    mkEnv(new FakeKV()), okFx);
  assert.equal(r.status, 400);
  assert.equal(JSON.parse(await r.text()).error, "validation");
});

test("A: >100GB total -> 400 validation", async () => {
  const r = await handleVaultSession(
    req({ files: [{ name: "huge.zip", size: 100 * 1024 ** 3 + 1 }], turnstile: "tok" }),
    mkEnv(new FakeKV()), okFx);
  assert.equal(r.status, 400);
});

test("A: turnstile reject -> 400 (fail-closed, spent at A)", async () => {
  const r = await handleVaultSession(
    req({ files: FILES, turnstile: "tok" }), mkEnv(new FakeKV()),
    { ...okFx, turnstile: async () => new Response(JSON.stringify({ success: false }), { status: 200 }) });
  assert.equal(r.status, 400);
});

test("A: no KV binding -> 503 vault_unavailable", async () => {
  const r = await handleVaultSession(
    req({ files: FILES, turnstile: "tok" }), { HASH_SALT: "s" }, okFx);
  assert.equal(r.status, 503);
  assert.equal(JSON.parse(await r.text()).error, "vault_unavailable");
});

test("A: non-POST -> 405", async () => {
  const r = await handleVaultSession(
    new Request("https://allofitnow.com/api/vault/session", { method: "GET" }),
    mkEnv(new FakeKV()), okFx);
  assert.equal(r.status, 405);
});

// ---- abort ------------------------------------------------------------------

test("abort: unknown uploadId -> 200 idempotent", async () => {
  const r = await handleVaultAbort(
    new Request("https://allofitnow.com/api/vault/abort", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: "aoin_cs=" + CS },
      body: JSON.stringify({ uploadId: "00000000-0000-4000-8000-000000000000" }),
    }),
    mkEnv(new FakeKV()));
  assert.equal(r.status, 200);
  assert.ok(JSON.parse(await r.text()).ok);
});

test("abort: wrong cookie -> 403 session binding", async () => {
  const kv = new FakeKV();
  await kv.put("vault:ABC", JSON.stringify({
    cs: "99999999-9999-9999-9999-999999999999", ip: "10.9.0.1", totalBytes: 24,
    consumed: false, files: [{ name: "x.pdf", size: 24 }],
  }));
  const r = await handleVaultAbort(
    new Request("https://allofitnow.com/api/vault/abort", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: "aoin_cs=" + CS },
      body: JSON.stringify({ uploadId: "ABC" }),
    }),
    mkEnv(kv));
  assert.equal(r.status, 403);
});
