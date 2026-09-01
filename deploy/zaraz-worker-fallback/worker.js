// 46009 routing worker - deploy/zaraz-worker-fallback/worker.js
// Issue #50: R2 custom domains do not resolve directory URLs (GET / and
// GET /work/ return 404 while /index.html and /work/index.html return 200)
// and Astro emits extensionless hrefs (/work/bad-bunny). This worker is
// therefore a REQUIRED routing layer in front of bucket 46009, not a
// fallback. It also puts serving behind a zone route so edge features
// (Zaraz, #32 Phase C) can act on HTML responses.
//
// Behavior: try path as-is; if miss and no file extension, retry
// <path>/index.html. On miss with percent-encoded path, retry the decoded
// key (R2 keys uploaded from CMS may contain literal spaces; URL.pathname
// keeps %20 - issue #53). HTML body IS mutated by design since v3b: injects
// the Zaraz loader tag, the inquiry shim, and (v3d, #66) gtag.js
// G-1TVWRSCCLN + manual page_view on astro:page-load + nav_menu_open bind
// (#63 AC2). 404s stay 404s (#50 AC4). gtag delivery replaces the dead
// Zaraz edge->GA4 forwarding path (#65); Zaraz /t pipeline stays for the 25
// custom triggers.

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

const ZARAZ_TAG = '<script src="/cdn-cgi/zaraz/i.js"></script>';
// v3d (#66): gtag.js first-party delivery to GA4 552018344.
const GTAG_TAG = '<script async src="https://www.googletagmanager.com/gtag/js?id=G-1TVWRSCCLN"></script>';
const GTAG_INIT = [
  '<script>window.dataLayer=window.dataLayer||[];',
  'function gtag(){dataLayer.push(arguments);}',
  'gtag(\'js\',new Date());',
  'gtag(\'config\',\'G-1TVWRSCCLN\',{send_page_view:false});</script>',
].join("");

// v3b: also inject the inquiry shim (zaraz.track on .im__send with typed
// subject). Zaraz custom-html tools are not delivered for Pageview-only
// firing, so the worker carries this inline instead. zaraz is defined
// synchronously by i.js which is injected immediately before this script.
// v3d SHIM v2 (#66): dual-fire inquiry_send + nav_menu_open + manual page_view
const SHIM = [
  '<script>(function(){function bind(){var b=document.querySelector(\'.im__send\');',
  'var n=document.querySelector(\'.aoin-nav__menu-btn\');',
  'var s=document.querySelector(\'input[data-im-subject]\');',
  'if(b&&!b.__aoinBound){b.__aoinBound=1;b.addEventListener(\'click\',function(){',
  'try{zaraz.track(\'inquiry_send\',{subject:(s&&s.value)||\'\'});}catch(e){}',
  'try{gtag(\'event\',\'inquiry_send\',{subject:(s&&s.value)||\'\'});}catch(e){}});}',
  'if(n&&!n.__aoinBound){n.__aoinBound=1;n.addEventListener(\'click\',function(){',
  'try{gtag(\'event\',\'nav_menu_open\');}catch(e){}});}}',
  'bind();document.addEventListener(\'astro:page-load\',function(){bind();',
  'try{gtag(\'event\',\'page_view\');}catch(e){}});})();</script>',
].join("");


export default {
  async fetch(request, env) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("method not allowed", { status: 405 });
    }
    const url = new URL(request.url);
    let key = url.pathname.replace(/^\/+/, "");
    if (key === "" || key.endsWith("/")) key += "index.html";

    let obj = await env.ASSETS.get(key);
    if (obj === null) {
      // #53: R2 keys uploaded from CMS may contain literal spaces; URL.pathname
      // keeps %20. Decode-on-miss only: zero change for clean keys.
      try {
        const dec = decodeURIComponent(key);
        if (dec !== key) {
          const o2 = await env.ASSETS.get(dec);
          if (o2 !== null) {
            key = dec;
            obj = o2;
          }
        }
      } catch (_) {} // malformed escape - fall through to 404 path
    }
    if (obj === null && hasExt(key) === false) {
      // extensionless path (Astro hrefs): /work/bad-bunny -> /work/bad-bunny/index.html
      const retry = key + "/index.html";
      const obj2 = await env.ASSETS.get(retry);
      if (obj2 !== null) {
        key = retry;
        obj = obj2;
      }
    }
    if (obj === null) {
      const notFound = await env.ASSETS.get("404.html");
      if (notFound !== null) {
        const buf = await notFound.arrayBuffer();
        return new Response(injectZaraz(buf, "html"), {
          status: 404,
          headers: {
            "content-type": MIME.html,
            "cache-control": "no-cache",
            "x-46009-worker": "v3d",
          },
        });
      }
      return new Response("not found", {
        status: 404,
        headers: { "x-46009-worker": "v3d" },
      });
    }

    const ext = key.slice(key.lastIndexOf(".") + 1).toLowerCase();
    const headers = new Headers();
    headers.set("etag", obj.httpEtag);
    headers.set("content-type", MIME[ext] || "application/octet-stream");
    headers.set("x-46009-worker", "v3d");
    if (ext === "html") {
      headers.set("cache-control", "no-cache");
    } else {
      headers.set("cache-control", "public, max-age=86400");
    }
    if (request.headers.get("if-none-match") === obj.httpEtag) {
      return new Response(null, { status: 304, headers });
    }
    if (ext === "html") {
      const buf = await obj.arrayBuffer();
      return new Response(injectZaraz(buf, "html"), { status: 200, headers });
    }
    return new Response(obj.body, { status: 200, headers });
  },
};

function injectZaraz(buf) {
  const html = new TextDecoder().decode(buf);
  if (html.includes("/cdn-cgi/zaraz/i.js")) return html; // idempotent
  const tags = ZARAZ_TAG + GTAG_TAG + GTAG_INIT + SHIM;
  if (html.includes("</head>")) {
    return html.replace("</head>", tags + "</head>");
  }
  return tags + html; // headless markup: prepend
}
