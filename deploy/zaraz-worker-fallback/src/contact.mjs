// src/contact.mjs — POST /api/contact (#112) — vet L1-L4 + SES + Vault (#130).
// SSOT: wiki "contact-form". Vet order pinned: shape/size -> L1 -> L3 -> L2 -> L4 -> send.
// v3p (#124): display-name From, sanitized ReplyTo display name, structured body.
// v4b (#130): attachments arrive browser->Drive (chunked, step A/B in
//             vault-api.mjs); this handler verifies staged uploads by pinned
//             identity (folder+stamp+size), consumes single-use, then sends
//             the manifest + Attachment Folder link. Spec wiki v4.

import {
  getDriveToken, folderUrl, loadStaged, consumeStaged, V4_TOTAL_MAX,
} from "./vault.mjs";

// ---- #125/#130: attachments ----------------------------------------------
// v4b: byte transports are GONE (ruling 7 — one transport). The worker vets
// declarations {name,size} at step A (vault-api.mjs) and verifies staged
// uploads at step C. Nothing here ever touches file bytes.
const FILE_MAX = 3;
const FILE_EXTS = new Set([
  "pdf", "doc", "docx", "ppt", "pptx", "key", "jpg", "jpeg", "png", "gif",
  "webp", "mp4", "mov", "webm", "zip",
]);

export function sanitizeFilename(raw) {
  let n = String(raw || "")
    .split(/[\\/]/).pop()                      // basename only — no path traversal
    .replace(/[\u0000-\u001f"<>;:]/g, "")      // control + header-breaker chars
    .replace(/\s+/g, " ").trim()
    .slice(0, 80);
  return n || "attachment";
}
const extOf = (name) => {
  const i = String(name).lastIndexOf(".");
  return i === -1 ? "" : String(name).slice(i + 1).toLowerCase();
};
// v4 (#130): declaration vet at step A — {name,size} pairs only
// (no bytes through the worker; chunks go browser→Drive).
export function vetFileDeclarations(files) {
  if (!Array.isArray(files) || files.length === 0 || files.length > FILE_MAX) return null;
  let total = 0;
  const out = [];
  for (const f of files) {
    if (!f || typeof f.name !== "string" || typeof f.size !== "number"
      || !Number.isSafeInteger(f.size) || f.size <= 0) return null;
    if (!FILE_EXTS.has(extOf(f.name))) return null;
    const name = sanitizeFilename(f.name);
    if (total + f.size > V4_TOTAL_MAX) return null;
    total += f.size;
    out.push({ name, size: f.size });
  }
  return out;
}
// Zero npm deps: SigV4 via WebCrypto, DoH/Turnstile/SES via plain fetch.

const STAMP = "v4b";
// #124: display-name From (static, no injection surface) + sanitized ReplyTo.
const FROM = '"AOIN Website" <support@allofitnow.com>';
export function replyToAddr(v) {
  const n = String(v.name || "")
    .replace(/["\\\r\n\u0000-\u001f]/g, " ")   // header-safe: no quotes/ctl
    .replace(/\s+/g, " ").trim().slice(0, 60);
  const email = String(v.email || "").replace(/[\r\n<>"\s]/g, ""); // defense-in-depth
  return n ? `"${n}" <${email}>` : email;
}
export function bodyText(v) {
  const line = "-".repeat(46);
  const rows = [
    `[AOIN/${String(v.topic).toUpperCase()}] WEBSITE INQUIRY`,
    line,
    `Name:    ${v.name}`,
    `Email:   ${v.email}`,
    `Topic:   ${v.topic}`,
  ];
  if (v.attachmentCount > 0) {
    rows.push(`Files:   ${v.attachmentCount} (secure upload)`);
    rows.push(`Attachment Folder: ${v.attachmentFolderUrl}`);
    for (const f of v.files || []) {
      rows.push(`  - ${f.name} (${f.size} bytes, ${f.type})`);
    }
  }
  rows.push(line, "", v.message, "", line,
    "Sent via the allofitnow.com contact form. Reply directly to respond.");
  return rows.join("\n");
}
// 2026-09-03 user decision: per-topic routing (all three mailboxes exist in
// Google Workspace). Supersedes D3 single-funnel. SSOT: wiki "contact-form".
const TO_BY_TOPIC = {
  general: "info@allofitnow.com",
  rentals: "rentals@allofitnow.com",
  careers: "careers@allofitnow.com",
};
const SES_REGION = "us-east-1";
const SES_HOST = "email.us-east-1.amazonaws.com";
const SES_PATH = "/v2/email/outbound-emails";

const ELAPSED_MIN_MS = 2500;   // D2: autofill headroom; spray bots caught by honeypot
const ELAPSED_MAX_MS = 86400000; // 24h sanity cap
const BODY_CAP = 16 * 1024;
const TOPICS = new Set(["general", "rentals", "careers"]);
const LIMITS = { hourIp: 5, hourEmail: 3, dayIp: 20 };

// CF public test keys (documented): always-pass pair for E2E/automation.
export const TS_TEST_SECRET = "1x0000000000000000000000000000000AA";

const enc = new TextEncoder();

function json(status, body, extra) {
  const headers = {
    "content-type": "application/json",
    "cache-control": "no-store",
    "x-46009-worker": STAMP,
  };
  if (extra) Object.assign(headers, extra);
  return new Response(JSON.stringify(body), { status, headers });
}
const badRequest = () => json(400, { ok: false, error: "validation" });

// ---- field validation (shape + L1) --------------------------------------

// #130: aoin_cs session cookie (HttpOnly, Secure, Lax, 400d) — worker sets it
// on HTML responses; this parses it back on the API side.
export function parseSessionCookie(cookieHeader) {
  if (!cookieHeader) return null;
  const m = cookieHeader.match(/(?:^|;\s*)aoin_cs=([A-Za-z0-9-]{36})/);
  return m ? m[1] : null;
}

export function validateFields(p) {
  if (p === null || typeof p !== "object" || Array.isArray(p)) return null;
  const name = typeof p.name === "string" ? p.name.trim() : "";
  if (name.length < 1 || name.length > 80) return null;
  const email = typeof p.email === "string" ? p.email.trim().toLowerCase() : "";
  if (email.length > 254 || !/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(email)) return null;
  const message = typeof p.message === "string" ? p.message.trim() : "";
  if (message.length < 10 || message.length > 5000) return null;
  if (!TOPICS.has(p.topic)) return null;
  // L1: honeypot must be empty/absent; elapsed within human bounds.
  if (p.company !== undefined && p.company !== null && String(p.company).trim() !== "") return null;
  if (typeof p.elapsed !== "number" || !Number.isFinite(p.elapsed)) return null;
  if (p.elapsed < ELAPSED_MIN_MS || p.elapsed > ELAPSED_MAX_MS) return null;
  if (typeof p.cf_turnstile !== "string" || p.cf_turnstile.length < 1 || p.cf_turnstile.length > 2048) return null;
  // v4b (#130): staged-upload reference (optional — present iff files ride along)
  if (p.uploadId !== undefined && (typeof p.uploadId !== "string" || !/^[0-9a-f-]{36}$/.test(p.uploadId))) return null;
  if (p.vault_files !== undefined) {
    if (!Array.isArray(p.vault_files)) return null;
    for (const vf of p.vault_files) {
      if (!vf || typeof vf !== "object") return null;
      if (typeof vf.id !== "string" || vf.id.length < 8 || vf.id.length > 128) return null;
      if (typeof vf.name !== "string" || vf.name.length > 120) return null;
    }
  }
  return { name, email, message, topic: p.topic, token: p.cf_turnstile };
}

// ---- L3: KV rate limits (fixed UTC buckets; hashed keys) -----------------

async function sha256Hex(s, salt) {
  const data = enc.encode(salt + ":" + s);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function bucketKeys(nowMs) {
  const hour = Math.floor(nowMs / 3600000);
  const day = Math.floor(nowMs / 86400000);
  return { hour, day };
}

export async function rateLimited(kv, salt, ip, email, nowMs) {
  const { hour, day } = bucketKeys(nowMs);
  const ipH = await sha256Hex("ip:" + ip, salt);
  const emH = await sha256Hex("em:" + email, salt);
  const checks = [
    [`rl:h${hour}:${ipH}`, LIMITS.hourIp, 3660],
    [`rl:h${hour}:${emH}`, LIMITS.hourEmail, 3660],
    [`rl:d${day}:${ipH}`, LIMITS.dayIp, 86460],
  ];
  let retryAfter = null;
  for (const [key, limit, ttl] of checks) {
    const cur = parseInt((await kv.get(key)) || "0", 10);
    if (cur >= limit) {
      // Retry-After: seconds to the next hour boundary (day keys share the coarser bound).
      retryAfter = Math.max(1, Math.ceil((3600000 - (nowMs % 3600000)) / 1000));
      return { limited: true, retryAfter };
    }
  }
  for (const [key, , ttl] of checks) {
    const cur = parseInt((await kv.get(key)) || "0", 10);
    await kv.put(key, String(cur + 1), { expirationTtl: ttl });
  }
  return { limited: false };
}

// ---- L2: sender-domain MX via DoH (fail-open on error) -------------------

function mxFromAnswer(doh) {
  if (!doh || doh.Status !== 0 || !Array.isArray(doh.Answer) || doh.Answer.length === 0) return false;
  const mx = doh.Answer.filter((a) => a.type === 15);
  if (mx.length === 0) return false;
  // RFC 7505 null-MX: single record, preference 0, exchange "."
  if (mx.length === 1 && mx[0].data.replace(/\s+/g, " ").trim() === "0 .") return false;
  return true;
}

async function domainHasMx(domain, kv, fetcher) {
  const f = fetcher || fetch;
  const cacheKey = "mx:" + domain;
  const cached = await kv.get(cacheKey);
  if (cached === "1") return true;
  if (cached === "0") return false;
  let hasMx = null; // null = unknown (fail-open)
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 3000);
    const r = await f(
      "https://cloudflare-dns.com/dns-query?name=" + encodeURIComponent(domain) + "&type=MX",
      { headers: { accept: "application/dns-json" }, signal: ctl.signal },
    );
    clearTimeout(t);
    if (r.ok) hasMx = mxFromAnswer(await r.json());
  } catch (_) {
    return true; // timeout/error: fail-open (availability; other layers hold)
  }
  if (hasMx !== null) await kv.put(cacheKey, hasMx ? "1" : "0", { expirationTtl: 86400 });
  return hasMx !== false;
}

// ---- L4: Turnstile siteverify (fail-CLOSED: same-vendor core) -----------

export async function turnstileOk(secret, token, ip, fetcher) {
  const f = fetcher || fetch;
  const body = new URLSearchParams({ secret, response: token });
  if (ip) body.set("remoteip", ip);
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 3000);
    const r = await f("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: body.toString(),
      headers: { "content-type": "application/x-www-form-urlencoded" },
      signal: ctl.signal,
    });
    clearTimeout(t);
    if (!r.ok) return false;
    const d = await r.json();
    return d.success === true;
  } catch (_) {
    return false; // fail-CLOSED
  }
}

// ---- SES SendEmail (hand-rolled SigV4, zero deps) ------------------------

async function hmac(keyBytes, msg) {
  const k = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(msg)));
}
async function sha256HexRaw(bytes) {
  const buf = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function sesPayload(v) {
  return {
    FromEmailAddress: FROM,
    ReplyToAddresses: [replyToAddr(v)],
    Destination: { ToAddresses: [TO_BY_TOPIC[v.topic] || TO_BY_TOPIC.general] },
    Content: {
      Simple: {
        Subject: { Data: `[AOIN/${v.topic}] ${v.name} - website inquiry` },
        Body: { Text: { Data: bodyText(v), Charset: "UTF-8" } },
      },
    },
  };
}

export async function sesSend(payload, key, secret, fetcher) {
  const f = fetcher || fetch;
  const body = JSON.stringify(payload);
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = await sha256HexRaw(enc.encode(body));
  const canonicalHeaders =
    "content-type:application/json\nhost:" + SES_HOST + "\nx-amz-date:" + amzDate + "\n";
  const signedHeaders = "content-type;host;x-amz-date";
  const canonicalRequest = [
    "POST", SES_PATH, "", canonicalHeaders, signedHeaders, payloadHash,
  ].join("\n");
  const scope = dateStamp + "/" + SES_REGION + "/ses/aws4_request";
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    await sha256HexRaw(enc.encode(canonicalRequest)),
  ].join("\n");
  let k = await hmac(enc.encode("AWS4" + secret), dateStamp);
  k = await hmac(k, SES_REGION);
  k = await hmac(k, "ses");
  k = await hmac(k, "aws4_request");
  const signature = [...(await hmac(k, stringToSign))].map((b) => b.toString(16).padStart(2, "0")).join("");
  const authorization =
    "AWS4-HMAC-SHA256 Credential=" + key + "/" + scope + ", SignedHeaders=" + signedHeaders +
    ", Signature=" + signature;
  const r = await f("https://" + SES_HOST + SES_PATH, {
    method: "POST",
    body,
    headers: {
      "content-type": "application/json",
      "x-amz-date": amzDate,
      authorization,
    },
  });
  if (!r.ok) throw new Error("ses " + r.status);
  return r.json();
}

// ---- handler -------------------------------------------------------------

export async function handleContact(request, env, fetchers) {
  const fx = fetchers || {};
  const e2e = request.headers.get("x-aoin-e2e") === "1";
  const declared = parseInt(request.headers.get("content-length") || "0", 10);
  // v4b (#130): JSON fields only — file bytes never pass through the worker
  // (ruling 7: one transport; the old multipart intake is gone).
  if (declared > BODY_CAP) {
    return json(413, { ok: false, error: "validation" });
  }
  let parsed;
  {
    let raw;
    try {
      raw = await request.text();
    } catch (_) {
      return badRequest();
    }
    if (enc.encode(raw).length > BODY_CAP) return json(413, { ok: false, error: "validation" });
    try {
      parsed = JSON.parse(raw);
    } catch (_) {
      return badRequest();
    }
  }

  const v = validateFields(parsed); // shape + L1 (honeypot + elapsed)
  if (!v) return badRequest();

  const kv = env && env.CONTACT_KV;
  const salt = (env && env.HASH_SALT) || "";
  const ip = request.headers.get("cf-connecting-ip") || "0.0.0.0";

  if (kv) { // L3 (skipped only when no KV binding, i.e. unit harness without KV)
    const rl = await rateLimited(kv, salt, ip, v.email, Date.now());
    if (rl.limited) {
      return json(429, { ok: false, error: "rate_limited" }, { "retry-after": String(rl.retryAfter) });
    }
  }

  // L2: MX (fail-open on DoH error)
  const domain = v.email.split("@")[1];
  if (kv && !(await domainHasMx(domain, kv, fx.doh))) return badRequest();

  // #130 v4b: attachments were uploaded browser→Drive before submit (step A
  // minted sessions; step B PUT chunks straight to Google). This request
  // carries form fields + {uploadId, files:[{id}]} only — NO file bytes.
  // Turnstile was spent at A (single-use, ruling 8); on the staged path the
  // gate is possession of the uploadId bound to this aoin_cs cookie. Files-
  // less submissions still verify Turnstile here.
  let payload;
  let attMeta = [];
  const uploadId = parsed.uploadId;
  const staged = uploadId ? await loadStaged(kv, uploadId) : null;
  const wantsFiles = Array.isArray(parsed.vault_files) && parsed.vault_files.length > 0;

  if (wantsFiles) {
    if (!kv || !staged || staged.consumed) return json(400, { ok: false, error: "session" });
    if (parseSessionCookie(request.headers.get("cookie")) !== staged.cs) {
      return json(403, { ok: false, error: "session" });
    }
    // exactly the staged files, nothing more
    if (parsed.vault_files.length !== staged.files.length) return badRequest();
    const idByStamp = new Map();
    for (const vf of parsed.vault_files) {
      if (!vf || typeof vf.id !== "string" || vf.id.length > 128) return badRequest();
      if (idByStamp.has(vf.name)) return badRequest(); // duplicate stamp
      idByStamp.set(vf.name, vf.id);
    }
    if (e2e) {
      attMeta = staged.files.map((f) => ({ name: f.name, size: f.size, type: "drive" }));
      const e2ePayload = sesPayload(v);
      e2ePayload.Content.Simple.Body.Text.Data = bodyText({
        ...v,
        attachmentCount: staged.files.length,
        attachmentFolderUrl: folderUrl(staged.folderId),
        files: attMeta,
      });
      return json(202, {
        ok: true,
        e2e: {
          payload: e2ePayload,
          attachments: attMeta,
          vault: {
            uploadId,
            sessionId: staged.cs,
            folderUrl: folderUrl(staged.folderId),
            wouldVerify: staged.files.map((f) => ({ name: f.name, size: f.size })),
          },
        },
      });
    }
    try {
      const token = await getDriveToken(env, fx.drive);
      const verified = [];
      for (const f of staged.files) {
        const id = idByStamp.get(f.name);
        if (!id) return badRequest(); // staged file not matched by client
        // Identity pin: verify the id resolves to THIS folder + THIS stamped
        // name + declared size. Foreign ids can't satisfy all three.
        const r = await fetch(
          "https://www.googleapis.com/drive/v3/files/" + encodeURIComponent(id) +
            "?fields=id,name,size,parents&supportsAllDrives=true",
          { headers: { authorization: "Bearer " + token } },
        );
        if (!r.ok) return json(400, { ok: false, error: "upload_stale" });
        const d = await r.json();
        if (d.name !== f.name || Number(d.size) !== f.size
          || !Array.isArray(d.parents) || !d.parents.includes(staged.folderId)) {
          return json(400, { ok: false, error: "upload_stale" });
        }
        verified.push({ name: d.name, size: d.size });
      }
      // consume single-use AFTER verification, BEFORE send (no replay).
      if (!(await consumeStaged(kv, uploadId))) return json(400, { ok: false, error: "session" });
      const enriched = {
        ...v,
        attachmentCount: verified.length,
        attachmentFolderUrl: folderUrl(staged.folderId),
        files: verified.map((u) => ({ name: u.name, size: u.size, type: "drive" })),
      };
      payload = sesPayload(enriched);
      payload.FromEmailAddress = FROM;
      payload.ReplyToAddresses = [replyToAddr(v)];
      payload.Destination = { ToAddresses: [TO_BY_TOPIC[v.topic] || TO_BY_TOPIC.general] };
      payload.Content.Simple.Body.Text.Data = bodyText(enriched);
      attMeta = verified.map((u) => ({ name: u.name, size: Number(u.size), type: "drive" }));
    } catch (_) {
      return json(502, { ok: false, error: "upstream" });
    }
  } else {
    // L4: Turnstile. E2E validates against the public always-pass test secret
    // (code path exercised); prod uses TURNSTILE_SECRET. Fail-closed.
    const secret = e2e
      ? ((env && env.TURNSTILE_E2E_SECRET) || TS_TEST_SECRET)
      : ((env && env.TURNSTILE_SECRET) || TS_TEST_SECRET);
    if (!(await turnstileOk(secret, v.token, ip, fx.turnstile))) return badRequest();
    payload = sesPayload(v);
  }
  if (e2e) return json(202, { ok: true, e2e: { payload, attachments: attMeta } });

  try {
    await sesSend(payload, env.SES_KEY, env.SES_SECRET, fx.ses);
  } catch (_) {
    return json(502, { ok: false, error: "upstream" });
  }
  return json(202, { ok: true });
}
