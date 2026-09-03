// src/vault.mjs — Contact Attachments Vault (#130; spec wiki
// "Contact-Attachments-Vault" FINAL v3). Google Drive upload tier:
// session-sandboxed folders under 46017_inbox + folder link in email.
//
// Zero npm deps: RS256 JWT via WebCrypto, Drive v3 REST via plain fetch.
// Probe-verified 2026-09-03 (E2E on the live shared drive):
//   - 46017_inbox lives in a SHARED DRIVE (driveId 0ALLKnjFo9KPmUk9PVA):
//     every call needs supportsAllDrives=true (+ includeItemsFromAllDrives
//     on queries) or it 404s.
//   - uploads MUST set parents:[<folder id>] — SA has no storage quota of
//     its own; parentless upload 403s.
//   - SA role = Content Manager: create/upload/list/trash all proven;
//     hard-delete (purge) NOT possible — trash only (fine: worker never
//     deletes user data; retention is periodic review).
//   - token: JWT-bearer grant, RS256, scope drive, 3599s.
//
// KV usage (CONTACT_KV):
//   gtoken:<sha>        -> cached OAuth access token (TTL 55 min)
//   folder:<aoin_cs>    -> Drive folder id for a session (TTL 30 d)
//   quota:d<b>:<ipH>    -> L5 daily byte quota counter (TTL 25 h)

const DRIVE = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/drive";

export const VAULT_INBOX_FOLDER = "13hKEAWhajPwywuc1m8CPPU9WqiV1AiA3"; // 46017_inbox

// L5: per-IP daily byte quota (storage-abuse guard). Spec §Security.
export const QUOTA_BYTES_PER_DAY = 200 * 1024 * 1024; // 200 MB/day/IP

const enc = new TextEncoder();

function b64url(bytes) {
  let s = "";
  const CHUNK = 32766;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += btoa(String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK)));
  }
  // base64 -> base64url (JWT): strip padding, +/ -> -_
  return s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function b64urlFromString(s) {
  return b64url(enc.encode(s));
}
export function b64ToBytes(b64) {
  // tolerate both standard and url-safe alphabets + padding
  const s = b64.replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "");
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ---- OAuth: SA JWT-bearer (RS256) ---------------------------------------

export async function getDriveToken(env, fetcher) {
  const f = fetcher || fetch;
  const kv = env && env.CONTACT_KV;
  const cacheKey = "gtoken:" + ((env && env.VAULT_SA_CLIENT_EMAIL) || "unknown");
  if (kv) {
    const cached = await kv.get(cacheKey);
    if (cached) return cached;
  }
  const email = (env && env.VAULT_SA_CLIENT_EMAIL) || "";
  const keyB64 = (env && env.VAULT_SA_PRIVATE_KEY) || "";
  if (!email || !keyB64) throw new Error("vault env missing");
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: email,
    scope: SCOPE,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  };
  const pkcs8 = b64ToBytes(keyB64);
  const key = await crypto.subtle.importKey(
    "pkcs8", pkcs8, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"],
  );
  const unsigned =
    b64urlFromString(JSON.stringify(header)) + "." + b64urlFromString(JSON.stringify(claims));
  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, enc.encode(unsigned)));
  const assertion = unsigned + "." + b64url(sig);
  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion,
  }).toString();
  const r = await f(TOKEN_URL, {
    method: "POST",
    body,
    headers: { "content-type": "application/x-www-form-urlencoded" },
  });
  if (!r.ok) throw new Error("vault token " + r.status);
  const d = await r.json();
  if (kv) await kv.put(cacheKey, d.access_token, { expirationTtl: 55 * 60 });
  return d.access_token;
}

// ---- Drive helpers --------------------------------------------------------

async function driveCall(token, method, url, bodyObj, fetcher, rawBody, ctype) {
  const f = fetcher || fetch;
  const headers = { authorization: "Bearer " + token };
  let body = null;
  if (bodyObj !== undefined && bodyObj !== null) {
    body = JSON.stringify(bodyObj);
    headers["content-type"] = "application/json";
  } else if (rawBody !== undefined && rawBody !== null) {
    body = rawBody;
    headers["content-type"] = ctype || "application/octet-stream";
  }
  const r = await f(url, { method, body, headers });
  if (!r.ok) {
    const err = new Error("vault drive " + method + " " + r.status);
    err.status = r.status;
    throw err;
  }
  return r.json().catch(() => ({}));
}

// ensureSessionFolder: one Drive folder per aoin_cs. KV-cached id with
// 404/403 self-heal (spec: recreate + re-cache, never hard-fail on stale).
export async function ensureSessionFolder(token, sessionId, kv, fetcher) {
  const cacheKey = "folder:" + sessionId;
  if (kv) {
    const cachedId = await kv.get(cacheKey);
    if (cachedId) {
      try {
        const meta = await driveCall(token, "GET",
          DRIVE + "/files/" + encodeURIComponent(cachedId) +
          "?fields=id&supportsAllDrives=true", undefined, fetcher);
        if (meta && meta.id) return cachedId;
      } catch (e) {
        if (e.status !== 404 && e.status !== 403) throw e;
        // stale cache (folder deleted/moved): self-heal below
      }
    }
  }
  // create (idempotent-enough: on a rare double-submit the folder name is
  // unique per session, second create makes a sibling; KV cache then pins
  // whichever landed first — acceptable, spec'd as such)
  const created = await driveCall(token, "POST",
    DRIVE + "/files?fields=id&supportsAllDrives=true",
    { name: sessionId, mimeType: "application/vnd.google-apps.folder", parents: [VAULT_INBOX_FOLDER] },
    fetcher);
  if (kv) await kv.put(cacheKey, created.id, { expirationTtl: 30 * 86400 });
  return created.id;
}

// uploadVaultFile: multipart upload into the session folder, timestamped
// name so repeat submissions never overwrite (spec §Folder layout).
export async function uploadVaultFile(token, folderId, file, fetcher) {
  // spec §folder layout: <YYYYMMDD-HHmmss>_<sanitizedFilename>
  const iso = new Date().toISOString().replace(/[-:]/g, ""); // 20260903T225903.123Z
  const ts = iso.slice(0, 8) + "-" + iso.slice(9, 15);
  const name = ts + "_" + file.name;
  const meta = JSON.stringify({ name, parents: [folderId] });
  const bnd = "aoinv" + crypto.randomUUID().replace(/-/g, "");
  const parts = [];
  parts.push("--" + bnd + "\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n" + meta + "\r\n");
  parts.push("--" + bnd + "\r\ncontent-type: " + (file.type || "application/octet-stream") + "\r\n\r\n");
  const head = enc.encode(parts.join(""));
  const tail = enc.encode("\r\n--" + bnd + "--");
  const body = new Uint8Array(head.length + file.bytes.length + tail.length);
  body.set(head, 0);
  body.set(file.bytes, head.length);
  body.set(tail, head.length + file.bytes.length);
  const d = await driveCall(token, "POST",
    DRIVE_UPLOAD + "/files?uploadType=multipart&fields=id,name,size&supportsAllDrives=true",
    undefined, fetcher, body, "multipart/related; boundary=" + bnd);
  return { id: d.id, name: d.name || name, size: d.size || String(file.bytes.length) };
}

export function folderUrl(folderId) {
  return "https://drive.google.com/drive/folders/" + folderId;
}

// L5 quota: per-IP daily byte quota, KV counter, fixed UTC day bucket.
export async function quotaCheck(kv, salt, ip, addBytes, nowMs) {
  if (!kv) return { ok: true };
  const day = Math.floor(nowMs / 86400000);
  const ipH = await sha256HexV("ip:" + ip, salt);
  const key = "quota:d" + day + ":" + ipH;
  const cur = parseInt((await kv.get(key)) || "0", 10);
  if (cur + addBytes > QUOTA_BYTES_PER_DAY) return { ok: false, used: cur };
  await kv.put(key, String(cur + addBytes), { expirationTtl: 25 * 3600 });
  return { ok: true, used: cur + addBytes };
}

async function sha256HexV(s, salt) {
  const data = enc.encode(salt + ":" + s);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
