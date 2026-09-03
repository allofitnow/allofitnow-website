// src/vault-api.mjs — #130 v4 step A: POST /api/vault/session (+ /api/vault/abort).
// Mints resumable Drive sessions for the browser to PUT chunks to directly
// (probe-proven 2026-09-03; wiki v4). Turnstile is spent HERE (ruling 8) —
// single-use token economy; step C (/api/contact) is gated by session
// possession + cookie binding instead.
import {
  getDriveToken, ensureSessionFolder, mintUploadSession, stageUpload,
  purgeStaged, quotaCheck, quotaRelease, stampFileName, V4_TOTAL_MAX,
} from "./vault.mjs";
import { turnstileOk, rateLimited, vetFileDeclarations, TS_TEST_SECRET } from "./contact.mjs";

function json(status, body, extra) {
  const headers = { "content-type": "application/json", "cache-control": "no-store" };
  if (extra) Object.assign(headers, extra);
  return new Response(JSON.stringify(body), { status, headers });
}
const badRequest = () => json(400, { ok: false, error: "validation" });

function parseSessionCookie(cookieHeader) {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === "aoin_cs" && rest.length) return rest.join("=");
  }
  return null;
}

// A: {files:[{name,size}], turnstile} -> {uploadId, files:[{name,size,url}]}
export async function handleVaultSession(request, env, fetchers) {
  const fx = fetchers || {};
  const e2e = request.headers.get("x-aoin-e2e") === "1";
  if (request.method !== "POST") return json(405, { ok: false, error: "method" });

  const kv = env && env.CONTACT_KV;
  const salt = (env && env.HASH_SALT) || "";
  const ip = request.headers.get("cf-connecting-ip") || "0.0.0.0";
  const origin = request.headers.get("origin") || "";
  if (!/^https:\/\/(www\.)?allofitnow\.com$|^https:\/\/46009\.someofitlater\.com$/.test(origin)) {
    return json(403, { ok: false, error: "origin" });
  }

  let body;
  try {
    const raw = await request.text();
    if (raw.length > 16384) return badRequest();
    body = JSON.parse(raw);
  } catch (_) {
    return badRequest();
  }

  const vetted = vetFileDeclarations(body.files); // ext allow-list, <=3, 100GB, sanitize
  if (!vetted) return badRequest();

  // L4 Turnstile — spent here, single use (ruling 8).
  const secret = e2e
    ? ((env && env.TURNSTILE_E2E_SECRET) || TS_TEST_SECRET)
    : ((env && env.TURNSTILE_SECRET) || TS_TEST_SECRET);
  if (typeof body.turnstile !== "string" || body.turnstile.length < 1 || body.turnstile.length > 2048) {
    return badRequest();
  }
  if (!(await turnstileOk(secret, body.turnstile, ip, fx.turnstile))) return badRequest();

  if (!kv) return json(503, { ok: false, error: "vault_unavailable" });

  // L1 (IP bucket only — no email at A).
  const rl = await rateLimited(kv, salt, ip, "", Date.now());
  if (rl.limited) return json(429, { ok: false, error: "rate_limited" }, { "retry-after": String(rl.retryAfter) });

  // L5 reserve.
  const totalBytes = vetted.reduce((n, f) => n + f.size, 0);
  const q = await quotaCheck(kv, salt, ip, totalBytes, Date.now());
  if (!q.ok) return json(429, { ok: false, error: "quota" });

  const sessionId = parseSessionCookie(request.headers.get("cookie"));
  if (!sessionId) return json(400, { ok: false, error: "session" });

  if (e2e) {
    return json(202, {
      ok: true,
      e2e: {
        sessionId,
        files: vetted.map((f) => ({ name: stampFileName(f.name), size: f.size })),
        totalBytes,
        origin,
      },
    });
  }

  try {
    const token = await getDriveToken(env, fx.drive);
    const folderId = await ensureSessionFolder(token, sessionId, kv, fx.drive);
    const staged = [];
    for (const f of vetted) {
      const stamped = stampFileName(f.name);
      const url = await mintUploadSession(token, folderId, stamped, origin, fx.drive);
      staged.push({ name: stamped, size: f.size });
      if (url) staged[staged.length - 1].url = url;
    }
    const uploadId = crypto.randomUUID();
    await stageUpload(kv, uploadId, { cs: sessionId, folderId, ip, totalBytes, files: staged });
    return json(200, { ok: true, uploadId, files: staged });
  } catch (_) {
    return json(502, { ok: false, error: "upstream" });
  }
}

// Abort: {uploadId} -> purge staged + refund quota. Browser also DELETEs the
// Drive session URLs itself (capability URLs; no worker involvement needed).
export async function handleVaultAbort(request, env, fetchers) {
  if (request.method !== "POST") return json(405, { ok: false, error: "method" });
  const kv = env && env.CONTACT_KV;
  if (!kv) return json(503, { ok: false, error: "vault_unavailable" });
  const salt = (env && env.HASH_SALT) || "";
  let body;
  try {
    body = JSON.parse(await request.text());
  } catch (_) {
    return badRequest();
  }
  const { loadStaged } = await import("./vault.mjs");
  const rec = await loadStaged(kv, String(body.uploadId || ""));
  if (!rec) return json(200, { ok: true }); // idempotent
  // binding: only the session that minted may abort
  const sessionId = parseSessionCookie(request.headers.get("cookie"));
  if (sessionId !== rec.cs) return json(403, { ok: false, error: "session" });
  await purgeStaged(kv, String(body.uploadId));
  await quotaRelease(kv, salt, rec.ip, rec.totalBytes, Date.now());
  return json(200, { ok: true });
}
