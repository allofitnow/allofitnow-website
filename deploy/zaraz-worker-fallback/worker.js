// 46009 routing worker v3o - deploy/zaraz-worker-fallback/worker.js
// v3m -> v3o (#123): Zaraz tag stripped (404 sitewide, superseded by GA4);
// GA4 loader + SHIM + consent banner injection remain.
// geo-aware consent gate in
// injectAnalytics() + worker-injected geo-split consent banner. Gate = single
// choke point for all tracking vectors (wiki cookie-compliance section 6).
import { gateOpen } from "./src/gate.mjs";
import { bannerFor } from "./src/banner.mjs";
import { loaderScriptTag, gtagInitJs } from "./src/inject-snippet.mjs";
import { handleContact } from "./src/contact.mjs";
import { handleVaultSession, handleVaultAbort } from "./src/vault-api.mjs";

// v3d -> v3f (#71 CUT-2 + #73 CUT-5), 2026-08-31:
//   1. Per-host GA4: Host header -> measurement id map. 46009 keeps
//      G-1TVWRSCCLN (staging ref, property 552018344); allofitnow.com gets
//      G-NDWE8QHK9W (property 552145556, stream 15529168521).
//   2. www.allofitnow.com -> allofitnow.com 301 (before cache, path+query
//      preserved). www is redirect-only, never served.
//   3. Legacy redirects (#73): /project/<slug> -> 301 map lookup
//      (deploy/worker/legacy-map.json, title-verified 6 entries), else
//      auto-rule /project/X -> /work/X when /work/X/index.html exists in R2
//      (EXACT-CASE; PESO-PLUMA-EXODO is live-200, lowercase 404s), else
//      fall through to natural 404. Evaluated AFTER www-301, BEFORE R2 fetch.
// Pin model unchanged: route-set = pin (46009.someofitlater.com/* today;
//      allofitnow.com/* + www.allofitnow.com/* on the new zone post-CUT-1).
// All v3d behavior carries over: decode-on-miss (#53), directory and
// extensionless retries (#50), 404s stay 404s, ETag/304 passthrough,
// html=no-cache / assets 1d, gtag+shim injection (#66/#63).
//
// Deployment: npx wrangler@3 deploy (from deploy/zaraz-worker-fallback/).
// The new-zone routes stay commented in wrangler.toml until CUT-1 lands
// (zone must exist in CF before routes can bind).

const MIME = {
  html: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  json: "application/json; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  avif: "image/avif",
  gif: "image/gif",
  ico: "image/x-icon",
  mp4: "video/mp4",
  webm: "video/webm",
  mp3: "audio/mpeg",
  txt: "text/plain; charset=utf-8",
  pdf: "application/pdf",
  woff: "font/woff",
  woff2: "font/woff2",
};

function hasExt(key) {
  const last = key.slice(key.lastIndexOf("/") + 1);
  return last.includes(".");
}

// ---- v3f: host-based serving config ------------------------------------

// Per-host GA4 measurement ids (#71 task 2d). Keyed by Host header value
// (lowercased). Every serving host MUST have an entry; the injected id
// follows the served hostname, not the certificate.
const GA4_BY_HOST = {
  "46009.someofitlater.com": "G-1TVWRSCCLN",   // staging ref (property 552018344)
  "allofitnow.com": "G-NDWE8QHK9W",            // prod (property 552145556)
};

// Hosts the worker serves (route-bound). www is NOT here: redirect-only.
const SERVING_HOSTS = new Set(["46009.someofitlater.com", "allofitnow.com"]);

// #73: title-verified legacy map (source of truth: wiki
// Legacy-URL-correlation-map section 3; data copy in deploy/worker/legacy-map.json).
const LEGACY_MAP = {
  "/project/melanie-martinez": "/work/trilogy",
  "/project/arcane-riot-undercity-nights": "/work/riot-x-arcane",
  "/project/linkin-park-from-zero": "/work/linkin-park",
  "/project/encanto-ar": "/work/encanto-at-the-hollywood-bowl",
  "/project/coldplay-bts-thevoice": "/work/coldplay-bts-ar",
  "/project/peso-pluma-exodo-tour": "/work/PESO-PLUMA-EXODO",
};


// v3o (#123): Zaraz stripped - GA4 loader + SHIM + consent banner remain.

// v3b shim (#63 AC2) + v3d manual page_view (#66); host-agnostic.
const SHIM = [
  '<script>(function(){function bind(){var b=document.querySelector(\'.im__send\');',
  'var n=document.querySelector(\'.aoin-nav__menu-btn\');',
  'var s=document.querySelector(\'input[data-im-subject]\');',
  'if(b&&!b.__aoinBound){b.__aoinBound=1;b.addEventListener(\'click\',function(){',
  'try{gtag(\'event\',\'inquiry_send\',{subject:(s&&s.value)||\'\'});}catch(e){}});}',
  'if(n&&!n.__aoinBound){n.__aoinBound=1;n.addEventListener(\'click\',function(){',
  'try{gtag(\'event\',\'nav_menu_open\');}catch(e){}});}}',
  'bind();document.addEventListener(\'DOMContentLoaded\',function(){bind();});',
  'document.addEventListener(\'astro:page-load\',function(){bind();});',
  'document.addEventListener(\'astro:after-swap\',function(){setTimeout(bind,50);setTimeout(bind,400);setTimeout(bind,1500);});',
  'if(window.MutationObserver){new MutationObserver(function(){bind();}).observe(document.documentElement,{childList:true,subtree:true});}})();</script>',
].join("");

function redirect301(location) {
  return new Response(null, {
    status: 301,
    headers: {
      "location": location,
      "cache-control": "public, max-age=86400",
      "x-46009-worker": "v3s",
    },
  });
}

// #130: aoin_cs session cookie — set on HTML responses when absent. Identifies
// the Drive upload folder sandbox (HttpOnly, Secure, Lax, 400d; consent class:
// essential — functional-only identifier, no tracking; wiki
// Contact-Attachments-Vault FINAL v3 §session cookie).
function ensureSessionCookie(request, response) {
  const cookie = request.headers.get("cookie") || "";
  if (/(?:^|;\s*)aoin_cs=/.test(cookie)) return response;
  const val = crypto.randomUUID();
  const headers = new Headers(response.headers);
  headers.append("set-cookie",
    `aoin_cs=${val}; Max-Age=34560000; Path=/; HttpOnly; Secure; SameSite=Lax`);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

// ---- v3r (#128): soft-launch overlay ------------------------------------

// The soft-launch host (46009) serves the soft/ namespace (written by
// prod.sh --soft) ahead of the live root, with per-request fallback.
// Promotion (promote.sh) copies soft/ -> root; afterwards soft == root and
// the overlay is transparent. Other hosts never read soft/.
const SOFT_PREFIX = "soft/";
const SOFT_HOST = "46009.someofitlater.com";

// Single resolution stage for one key: in soft mode try soft/<key> first
// (hit wins, tagged), else root <key>. Null only when BOTH miss.
async function assetLookup(env, key, soft) {
  if (soft) {
    const s = await env.ASSETS.get(SOFT_PREFIX + key);
    if (s !== null) return { obj: s, key: SOFT_PREFIX + key, softHit: true };
  }
  const o = await env.ASSETS.get(key);
  if (o !== null) return { obj: o, key, softHit: false };
  return null;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const host = (request.headers.get("host") || url.hostname).toLowerCase();
    const soft = host === SOFT_HOST;

    // v3m (#112): contact API — sole POST surface, must sit ABOVE the generic
    // GET/HEAD method gate. Host-pinned like every other path; robots.txt
    // disallows /api/ for all agents.
    // v4 (#130): + /api/vault/session (A) and /api/vault/abort — POST-only.
    if (url.pathname === "/api/contact") {
      if (request.method !== "POST") {
        return new Response("method not allowed", {
          status: 405,
          headers: { "allow": "POST", "x-46009-worker": "v3s" },
        });
      }
      if (!SERVING_HOSTS.has(host)) {
        return new Response("host not served", {
          status: 403,
          headers: { "x-46009-worker": "v3s" },
        });
      }
      return handleContact(request, env);
    }

    if (url.pathname === "/api/vault/session" || url.pathname === "/api/vault/abort") {
      if (request.method !== "POST") {
        return new Response("method not allowed", {
          status: 405,
          headers: { "allow": "POST", "x-46009-worker": "v3s" },
        });
      }
      if (!SERVING_HOSTS.has(host)) {
        return new Response("host not served", {
          status: 403,
          headers: { "x-46009-worker": "v3s" },
        });
      }
      return url.pathname === "/api/vault/session"
        ? handleVaultSession(request, env)
        : handleVaultAbort(request, env);
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("method not allowed", { status: 405 });
    }

    // 1. www -> apex 301 (#71 task 2c): before cache, path+query preserved.
    if (host === "www.allofitnow.com") {
      return redirect301("https://allofitnow.com" + url.pathname + url.search);
    }

    // 1b. hostname pin (#71 task 2b): deny-by-default. Only www (redirected
    // above) + SERVING_HOSTS may pass; anything else reaching this worker
    // (route widening, future zones) gets 403 before any R2 read.
    if (!SERVING_HOSTS.has(host)) {
      return new Response("host not served", {
        status: 403,
        headers: { "x-46009-worker": "v3s" },
      });
    }

    // 2. legacy redirects (#73): after www-301, before R2 fetch.
    const legacy = LEGACY_MAP[url.pathname];
    if (legacy) {
      return redirect301("https://allofitnow.com" + legacy + url.search);
    }
    if (url.pathname.startsWith("/project/")) {
      // auto-rule: /project/X -> /work/X only when the target is live.
      // EXACT-CASE R2 existence check (decoded-on-miss handling below is
      // irrelevant here: work pages are clean slugs). One hop, no loop:
      // map targets are /work/ slugs; /work/ never maps back.
      const candidate = "work/" + url.pathname.slice("/project/".length) + "/index.html";
      const probe = await env.ASSETS.get(candidate);
      if (probe !== null) {
        const target = "/work/" + url.pathname.slice("/project/".length);
        return redirect301("https://allofitnow.com" + target + url.search);
      }
      // miss -> fall through to natural 404 below
    }

    // v3f (#71 task 5a): the rollback archive must NOT be publicly
    // served (2,803 objects of stale HTML+media; injection would also
    // stamp live-host gtags into archived pages post-flip). Deny before
    // the R2 fetch; rollback reads R2 directly, so the axis is intact.
    if (url.pathname.startsWith("/archive/")) {
      return new Response("not found", {
        status: 404,
        headers: { "x-46009-worker": "v3s" },
      });
    }

    // v3r (#128): the soft namespace itself is never publicly served —
    // it exists only as the overlay source for the soft-launch host.
    if (url.pathname.startsWith("/soft/")) {
      return new Response("not found", {
        status: 404,
        headers: { "x-46009-worker": "v3s" },
      });
    }

    let key = url.pathname.replace(/^\/+/, "");
    if (key === "" || key.endsWith("/")) key += "index.html";

    // v3r (#128): soft overlay at every resolution stage.
    let hit = await assetLookup(env, key, soft);
    if (hit === null) {
      // #53: R2 keys uploaded from CMS may contain literal spaces; URL.pathname
      // keeps %20. Decode-on-miss only: zero change for clean keys.
      try {
        const dec = decodeURIComponent(key);
        if (dec !== key) {
          const h2 = await assetLookup(env, dec, soft);
          if (h2 !== null) {
            key = dec;
            hit = h2;
          }
        }
      } catch (_) {} // malformed escape - fall through to 404 path
    }
    if (hit === null && hasExt(key) === false) {
      // extensionless path (Astro hrefs): /work/bad-bunny -> /work/bad-bunny/index.html
      const h3 = await assetLookup(env, key + "/index.html", soft);
      if (h3 !== null) {
        key = key + "/index.html";
        hit = h3;
      }
    }
    if (hit === null) {
      const notFound = await env.ASSETS.get("404.html");
      if (notFound !== null) {
        const buf = await notFound.arrayBuffer();
        return ensureSessionCookie(request, new Response(injectAnalytics(buf, host, request.headers.get("cf-ipcountry"), request.headers.get("cookie")), {
          status: 404,
          headers: {
            "content-type": MIME.html,
            "cache-control": "no-cache",
            "x-46009-worker": "v3s",
          },
        }));
      }
      return new Response("not found", {
        status: 404,
        headers: { "x-46009-worker": "v3s" },
      });
    }

    const ext = key.slice(key.lastIndexOf(".") + 1).toLowerCase();
    const headers = new Headers();
    headers.set("etag", hit.obj.httpEtag);
    headers.set("content-type", MIME[ext] || "application/octet-stream");
    headers.set("x-46009-worker", "v3s");
    if (soft) headers.set("x-46009-soft", hit.softHit ? "hit" : "fallback");
    if (ext === "html") {
      headers.set("cache-control", "no-cache");
    } else {
      headers.set("cache-control", "public, max-age=86400");
    }
    if (request.headers.get("if-none-match") === hit.obj.httpEtag) {
      return new Response(null, { status: 304, headers });
    }
    if (ext === "html") {
      const buf = await hit.obj.arrayBuffer();
      return ensureSessionCookie(request, new Response(injectAnalytics(buf, host, request.headers.get("cf-ipcountry"), request.headers.get("cookie")), { status: 200, headers }));
    }
    return new Response(hit.obj.body, { status: 200, headers });
  },
};

function injectAnalytics(buf, host, country, cookieHeader) {
  const html = new TextDecoder().decode(buf);
  const ga4id = GA4_BY_HOST[host] || GA4_BY_HOST["46009.someofitlater.com"];
  // design-preview fab: any host except production (owner ruling 2026-09-01)
  const preview = host !== "allofitnow.com" && host !== "www.allofitnow.com";
  // #76 consent gate: single choke point. Gate closed -> serve the page with
  // the banner ONLY (no tracking of any kind). Never bare-return (undefined
  // wrapped in a Response would throw).
  if (!gateOpen(country, cookieHeader)) {
    const b = bannerFor(country, ga4id, cookieHeader, preview);
    return appendBeforeBodyEnd(html, b.html);
  }
  // v3o (#123): guard on the GA4 loader (Zaraz stripped; old guard keyed on
  // the zaraz tag string and would wrongly skip injection everywhere post-strip)
  if (html.includes("googletagmanager")) return html; // idempotent
  const tags = loaderScriptTag(ga4id) + "<script>" + gtagInitJs(ga4id, country) + "</script>" + SHIM;
  let out = html;
  if (out.includes("</head>")) {
    out = out.replace("</head>", tags + "</head>");
  } else {
    out = tags + out; // headless markup: prepend
  }
  // #77 banner: gate open (notice regime default-ON, or consented opt-in
  // visitor) still needs the notice line + footer settings control.
  const b = bannerFor(country, ga4id, cookieHeader, preview);
  return appendBeforeBodyEnd(out, b.html);
}

function appendBeforeBodyEnd(html, fragment) {
  if (html.includes("</body>")) {
    return html.replace("</body>", fragment + "</body>");
  }
  return html + fragment; // headless markup: append
}
