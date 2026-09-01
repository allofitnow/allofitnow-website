// Staging-only preview deployment for cookie compliance (#76/#77 visual test).
//
// Serves the REAL site from R2 via the REAL v3j worker logic (imported, zero
// drift) on a workers.dev URL - no routes touched, prod zones still v3i.
// The wrapper rewrites Host to 46009.someofitlater.com, so you see exactly
// what staging serves, banner included.
//
// TEST MODE - append ?aoin_geo=<CODE> to any page URL:
//   ?aoin_geo=GB   -> opt-in jurisdiction: BLOCKING MODAL, no tracking
//   ?aoin_geo=DE   -> same modal (any EU code)
//   ?aoin_geo=MUS  -> any OTHER code = notice regime (tracking on)
//   ?aoin_geo=none -> geo unknown: fail-closed modal
// The override affects the consent subsystem only (it rewrites cf-ipcountry);
// routing, pin, redirects unchanged. Responses are no-store.
//
// Revert: npx wrangler@3 delete --name aoin-46009-preview
// (staging route itself never changed - main worker v3i keeps serving it)

import worker from "./worker.js";

const VALID = /^[A-Z]{2}$/;
const STAGING_HOST = "46009.someofitlater.com";
const ZARAZ_TAG_RE = /<script[^>]*src="\/cdn-cgi\/zaraz\/[^"]*"[^>]*><\/script>/g;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const geo = url.searchParams.get("aoin_geo");
    url.searchParams.delete("aoin_geo");

    const h = new Headers(request.headers);
    h.set("host", STAGING_HOST);
    if (geo !== null) {
      const g = geo.toUpperCase();
      if (g === "NONE" || !VALID.test(g)) {
        h.delete("cf-ipcountry");
      } else {
        h.set("cf-ipcountry", g);
      }
    }

    const inner = new Request(url.toString(), {
      method: request.method,
      headers: h,
      body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
    });
    const resp = await worker.fetch(inner, env, ctx);
    const rh = new Headers(resp.headers);
    rh.set("cache-control", "no-store");
    // strip the Zaraz loader tag: /cdn-cgi/* doesn't exist on workers.dev
    // (zone feature) - leaving it in just produces a console 404.
    const ct = rh.get("content-type") || "";
    if (ct.includes("text/html")) {
      let t = await resp.text();
      t = t.replace(ZARAZ_TAG_RE, "");
      return new Response(t, { status: resp.status, headers: rh });
    }
    return new Response(resp.body, { status: resp.status, headers: rh });
  },
};
