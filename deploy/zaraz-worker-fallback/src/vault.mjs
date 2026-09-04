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
export const QUOTA_BYTES_PER_DAY = 100 * 1024 * 1024 * 1024; // 100 GB/day/IP (ruling ⑥/⑨)

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

// uploadVaultFile (v3 worker-side multipart upload) REMOVED in v4 — file
// bytes never pass through the worker; the browser PUTs chunks straight to
// Google on the minted session URL (ruling 7: one transport).

export function folderUrl(folderId) {
  return "https://drive.google.com/drive/folders/" + folderId;
}

// v4: pre-stamped upload name (<YYYYMMDD-HHmmss>_<name>) — the worker mints
// sessions with this exact name; step C pins file identity by (folderId,
// stampedName, declaredSize), so a client-supplied foreign Drive file id
// can never ride a submission.
export function stampFileName(rawName) {
  const iso = new Date().toISOString().replace(/[-:]/g, "");
  const ts = iso.slice(0, 8) + "-" + iso.slice(9, 15);
  return ts + "_" + rawName;
}

// ---- v4 chunked transport (#130 ruling ⑥/⑦) ------------------------------
// Browser PUTs bytes straight to Google via resumable session URLs; the
// worker only mints (A) and verifies (C). Probe-proven 2026-09-03:
//   mint: POST /upload/drive/v3/files?uploadType=resumable, SA auth,
//         metadata-only {name, parents} + Origin header -> 200 + Location.
//   chunks: PUT session URL, Content-Range bytes a-b/total, NO auth
//         (capability URL); non-final chunks MUST be 256 KB multiples.
//         CORS-readable (ACAO + Range exposed) iff mint carried Origin.
//   status: PUT session URL, Content-Range "bytes */total", no body -> 308+Range.
//   abort: DELETE session URL -> session dies, nothing created.

export const V4_TOTAL_MAX = 100 * 1024 * 1024 * 1024; // 100 GB per submission
export const V4_STAGE_TTL = 24 * 3600;                // KV staged-upload TTL

// mintUploadSession: one resumable session per file, name pre-stamped.
export async function mintUploadSession(token, folderId, fileName, origin, fetcher) {
  const r = await (fetcher || fetch)(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&fields=id,name,size",
    {
      method: "POST",
      headers: {
        authorization: "Bearer " + token,
        "content-type": "application/json; charset=UTF-8",
        // Probe 2a: Origin MUST ride the mint or chunk PUTs lose CORS
        // readability in the browser. Google echoes the declared origin.
        origin,
      },
      body: JSON.stringify({ name: fileName, parents: [folderId] }),
    },
  );
  if (!r.ok) throw new Error("mint " + r.status);
  return r.headers.get("location"); // session URL = bearer capability, never log
}

// verifyFileMeta: C-step check — Google-reported size must equal declared.
export async function verifyFileMeta(token, fileId, declaredBytes, fetcher) {
  const r = await (fetcher || fetch)(
    "https://www.googleapis.com/drive/v3/files/" + fileId +
      "?fields=size,name&supportsAllDrives=true",
    { headers: { authorization: "Bearer " + token } },
  );
  if (!r.ok) return { ok: false, why: r.status };
  const d = await r.json();
  if (Number(d.size) !== Number(declaredBytes)) return { ok: false, why: "size", size: d.size };
  return { ok: true, name: d.name, size: d.size };
}

// ---- staged uploads (KV): single-use A→C binding ---------------------------
// key vault:<uploadId> -> {cs, folderId, files:[{id,name,size,url}], consumed}
// consumed flips at C; TTL bounds abandoned sessions (ruling 10).

export function stageKey(uploadId) { return "vault:" + uploadId; }

export async function stageUpload(kv, uploadId, rec) {
  await kv.put(stageKey(uploadId), JSON.stringify({ ...rec, consumed: false }),
    { expirationTtl: V4_STAGE_TTL });
}

export async function loadStaged(kv, uploadId) {
  const raw = await kv.get(stageKey(uploadId));
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export async function consumeStaged(kv, uploadId) {
  const rec = await loadStaged(kv, uploadId);
  if (!rec || rec.consumed) return null; // single use
  await kv.put(stageKey(uploadId), JSON.stringify({ ...rec, consumed: true }),
    { expirationTtl: 3600 }); // short tail for replay forensics, then gone
  return rec;
}

export async function purgeStaged(kv, uploadId) {
  await kv.delete(stageKey(uploadId));
}

// ---- quota: v4 uses reserve/release around the staged window ---------------
// (quotaCheck above still gates; releaseStaged refunds if C never comes
// manually — TTL handles the abandoned case.)

export async function quotaRelease(kv, salt, ip, releaseBytes, nowMs) {
  if (!kv) return;
  const day = Math.floor(nowMs / 86400000);
  const ipH = await sha256HexV("ip:" + ip, salt);
  const key = "quota:d" + day + ":" + ipH;
  const cur = parseInt((await kv.get(key)) || "0", 10);
  const next = Math.max(0, cur - releaseBytes);
  await kv.put(key, String(next), { expirationTtl: 25 * 3600 });
}

// humanSize for the email manifest (B/KB/MB/GB).
export function humanSize(n) {
  const u = ["B", "KB", "MB", "GB"];
  let i = 0, v = Number(n);
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return (i === 0 ? v : v.toFixed(1)) + " " + u[i];
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
