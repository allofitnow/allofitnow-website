// 46009 routing worker - deploy/zaraz-worker-fallback/worker.js
// Issue #50: R2 custom domains do not resolve directory URLs (GET / and
// GET /work/ return 404 while /index.html and /work/index.html return 200)
// and Astro emits extensionless hrefs (/work/bad-bunny). This worker is
// therefore a REQUIRED routing layer in front of bucket 46009, not a
// fallback. It also puts serving behind a zone route so edge features
// (Zaraz, #32 Phase C) can act on HTML responses.
//
// Behavior: try path as-is; if miss and no file extension, retry
// <path>/index.html. No body mutation ever (AC5). 404s stay 404s (AC4).

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

export default {
  async fetch(request, env) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("method not allowed", { status: 405 });
    }
    const url = new URL(request.url);
    let key = url.pathname.replace(/^\/+/, "");
    if (key === "" || key.endsWith("/")) key += "index.html";

    let obj = await env.ASSETS.get(key);
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
        return new Response(notFound.body, {
          status: 404,
          headers: {
            "content-type": MIME.html,
            "cache-control": "no-cache",
            "x-46009-worker": "v2",
          },
        });
      }
      return new Response("not found", {
        status: 404,
        headers: { "x-46009-worker": "v2" },
      });
    }

    const ext = key.slice(key.lastIndexOf(".") + 1).toLowerCase();
    const headers = new Headers();
    headers.set("etag", obj.httpEtag);
    headers.set("content-type", MIME[ext] || "application/octet-stream");
    headers.set("x-46009-worker", "v2");
    if (ext === "html") {
      headers.set("cache-control", "no-cache");
    } else {
      headers.set("cache-control", "public, max-age=86400");
    }
    if (request.headers.get("if-none-match") === obj.httpEtag) {
      return new Response(null, { status: 304, headers });
    }
    return new Response(obj.body, { status: 200, headers });
  },
};
