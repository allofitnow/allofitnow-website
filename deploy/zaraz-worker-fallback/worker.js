// Zaraz injection fallback worker - deploy/zaraz-worker-fallback/worker.js
// Purpose: serve bucket 46009 objects through a zone route so Cloudflare
// edge features (Zaraz) can inject into HTML responses, IF direct R2
// custom domain serving turns out not to receive Zaraz injection
// (production-delivery spec section 7 empirical gate).
// ACTIVATE ONLY ON GATE FAILURE. See README.md in this directory.

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

export default {
  async fetch(request, env) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("method not allowed", { status: 405 });
    }
    const url = new URL(request.url);
    let key = url.pathname.replace(/^\/+/, "");
    if (key === "" || key.endsWith("/")) key += "index.html";

    const obj = await env.ASSETS.get(key);
    if (obj === null) {
      const notFound = await env.ASSETS.get("404.html");
      if (notFound !== null) {
        return new Response(notFound.body, {
          status: 404,
          headers: {
            "content-type": MIME.html,
            "x-46009-worker": "v1",
          },
        });
      }
      return new Response("not found", {
        status: 404,
        headers: { "x-46009-worker": "v1" },
      });
    }

    const ext = key.slice(key.lastIndexOf(".") + 1).toLowerCase();
    const headers = new Headers();
    headers.set("etag", obj.httpEtag);
    headers.set("content-type", MIME[ext] || "application/octet-stream");
    headers.set("x-46009-worker", "v1");
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
