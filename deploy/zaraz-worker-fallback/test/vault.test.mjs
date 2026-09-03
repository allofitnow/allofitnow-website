// test/vault.test.mjs — #130 Contact Attachments Vault unit tests.
// Offline: Drive + OAuth + KV all mocked. No network, no secrets.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getDriveToken, ensureSessionFolder, uploadVaultFile, folderUrl,
  quotaCheck, b64ToBytes, b64urlFromString, VAULT_INBOX_FOLDER,
} from "../src/vault.mjs";

const enc = new TextEncoder();

// ---- helpers: mock KV + fetch -------------------------------------------

function mockKv() {
  const m = new Map();
  return {
    m,
    async get(k) { return m.has(k) ? m.get(k) : null; },
    async put(k, v, opts) { m.set(k, v); if (opts && opts._t) m._ttl = opts._t; },
  };
}

function resJson(obj, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => obj };
}

function genRsa() {
  // Real RSA keypair for sign-path coverage (WebCrypto in Node 18+).
  return crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true, ["sign", "verify"],
  );
}

// ---- JWT mint + token cache ----------------------------------------------

test("getDriveToken: mints RS256 JWT-bearer token and caches in KV", async () => {
  const kp = await genRsa();
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", kp.privateKey));
  // base64 (standard) — as wrangler secret would store
  let b64 = "";
  for (let i = 0; i < pkcs8.length; i += 32766) {
    b64 += btoa(String.fromCharCode.apply(null, pkcs8.subarray(i, i + 32766)));
  }
  const env = { VAULT_SA_CLIENT_EMAIL: "sa@test.iam.gserviceaccount.com", VAULT_SA_PRIVATE_KEY: b64, CONTACT_KV: mockKv() };
  let calls = 0;
  const f = async (url, init) => {
    calls++;
    assert.equal(url, "https://oauth2.googleapis.com/token");
    const body = new URLSearchParams(init.body);
    const assertion = body.get("assertion");
    assert.match(assertion, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    const [h, p] = assertion.split(".");
    const hdr = JSON.parse(new TextDecoder().decode(b64ToBytes(h)));
    assert.equal(hdr.alg, "RS256");
    const claims = JSON.parse(new TextDecoder().decode(b64ToBytes(p)));
    assert.equal(claims.iss, "sa@test.iam.gserviceaccount.com");
    assert.equal(claims.scope, "https://www.googleapis.com/auth/drive");
    // verify signature against the public key
    const pub = await crypto.subtle.importKey("spki", await crypto.subtle.exportKey("spki", kp.publicKey), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", pub, b64ToBytes(assertion.split(".")[2]), enc.encode(h + "." + p));
    assert.ok(ok, "RS256 signature verifies");
    return resJson({ access_token: "TOKEN1", expires_in: 3599 });
  };
  const t1 = await getDriveToken(env, f);
  assert.equal(t1, "TOKEN1");
  const t2 = await getDriveToken(env, f); // KV cache hit
  assert.equal(t2, "TOKEN1");
  assert.equal(calls, 1, "second call served from KV cache");
});

test("getDriveToken: throws on missing env", async () => {
  await assert.rejects(() => getDriveToken({}, fetch), /vault env missing/);
});

// ---- ensureSessionFolder: cache hit / create / self-heal ------------------

test("ensureSessionFolder: KV hit + live folder -> reuse, no create", async () => {
  const kv = mockKv();
  await kv.put("folder:SESS1", "FID1");
  let creates = 0;
  const f = async (url) => {
    if (url.includes("/files/FID1")) return resJson({ id: "FID1" }); // metadata GET ok
    creates++;
    return resJson({ id: "NEW" });
  };
  const id = await ensureSessionFolder("T", "SESS1", kv, f);
  assert.equal(id, "FID1");
  assert.equal(creates, 0);
});

test("ensureSessionFolder: no cache -> create under 46017_inbox, cache id", async () => {
  const kv = mockKv();
  const f = async (url, init) => {
    assert.ok(url.includes("supportsAllDrives=true"), "shared-drive flag");
    const body = JSON.parse(init.body);
    assert.equal(body.parents[0], VAULT_INBOX_FOLDER);
    assert.equal(body.mimeType, "application/vnd.google-apps.folder");
    assert.equal(body.name, "SESS2");
    return resJson({ id: "FID2" });
  };
  const id = await ensureSessionFolder("T", "SESS2", kv, f);
  assert.equal(id, "FID2");
  assert.equal(await kv.get("folder:SESS2"), "FID2");
});

test("ensureSessionFolder: stale cache (404) -> self-heal recreate", async () => {
  const kv = mockKv();
  await kv.put("folder:SESS3", "DEAD");
  const f = async (url, init) => {
    if (url.includes("/files/DEAD")) {
      const e = new Error("404"); e.status = 404; throw e;
    }
    return resJson({ id: "FID3" });
  };
  const id = await ensureSessionFolder("T", "SESS3", kv, f);
  assert.equal(id, "FID3");
  assert.equal(await kv.get("folder:SESS3"), "FID3", "cache re-written");
});

test("ensureSessionFolder: non-404 error propagates (Strict-Drive)", async () => {
  const kv = mockKv();
  await kv.put("folder:SESS4", "DEAD");
  const f = async () => { const e = new Error("500"); e.status = 500; throw e; };
  await assert.rejects(() => ensureSessionFolder("T", "SESS4", kv, f));
});

// ---- uploadVaultFile ------------------------------------------------------

test("uploadVaultFile: multipart body, parents set, timestamped name", async () => {
  let seen = null;
  const f = async (url, init) => {
    assert.ok(url.includes("uploadType=multipart"));
    assert.ok(url.includes("supportsAllDrives=true"));
    const ctype = init.headers["content-type"];
    const bnd = ctype.match(/boundary=(.+)$/)[1];
    const text = new TextDecoder().decode(init.body);
    assert.ok(text.includes("--" + bnd));
    const meta = JSON.parse(text.match(/\{[^}]*parents[^}]*\}/)[0]);
    assert.equal(meta.parents[0], "FIDX");
    assert.match(meta.name, /^\d{8}-?\d{6}_report\.pdf$/);
    seen = meta;
    return resJson({ id: "UP1", name: meta.name, size: "9" });
  };
  const out = await uploadVaultFile("T", "FIDX", { name: "report.pdf", type: "application/pdf", bytes: enc.encode("123456789") }, f);
  assert.equal(out.id, "UP1");
  assert.match(out.name, /_report\.pdf$/);
});

// ---- folderUrl ------------------------------------------------------------

test("folderUrl", () => {
  assert.equal(folderUrl("ABC"), "https://drive.google.com/drive/folders/ABC");
});

// ---- L5 quota -------------------------------------------------------------

test("quotaCheck: under limit ok, over limit 429-class refusal, no KV -> ok", async () => {
  const kv = mockKv();
  const salt = "s";
  // fixed clock: pass nowMs explicitly
  const now = 1760000000000;
  const a = await quotaCheck(kv, salt, "1.2.3.4", 1000, now);
  assert.equal(a.ok, true);
  const b = await quotaCheck(kv, salt, "1.2.3.4", 200 * 1024 * 1024, now);
  assert.equal(b.ok, false, "day total exceeds 200MB cap");
  const c = await quotaCheck(kv, salt, "5.6.7.8", 1000, now);
  assert.equal(c.ok, true, "different IP unaffected");
  const d = await quotaCheck(null, salt, "1.2.3.4", 999 * 1024 * 1024, now);
  assert.equal(d.ok, true, "no KV binding -> unit harness -> allow");
});

// ---- b64 helpers ----------------------------------------------------------

test("b64urlFromString round-trips through b64ToBytes", () => {
  const s = '{"alg":"RS256","typ":"JWT"+ünïcödé/+/==}';
  const b = b64urlFromString(s);
  assert.equal(new TextDecoder().decode(b64ToBytes(b)), s);
});
