// test/soft-overlay.test.mjs — unit suite for worker v3r soft overlay (#128)
// Run: node --test test/soft-overlay.test.mjs
// Mocks env.ASSETS only. The worker's other imports (contact, banner, gate)
// are side-effect-safe pure modules already exercised by sibling suites.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

const worker = (await import("../worker.js")).default;

const enc = new TextEncoder();

// Key -> body map: one mock bucket holding soft/ namespace + live root.
function makeEnv(map) {
  return {
    ASSETS: {
      async get(k) {
        const body = map[k];
        if (body === undefined) return null;
        return {
          body,
          httpEtag: `"${k}"`,
          arrayBuffer: async () => enc.encode(body),
        };
      },
    },
  };
}

function req(path, host, method = "GET") {
  return new Request(`https://${host}${path}`, { method });
}

const HTML = "<!doctype html><html><head></head><body>hi</body></html>";
const SOFT_HOST = "46009.someofitlater.com";
const LIVE_HOST = "allofitnow.com";

const MAP = {
  "404.html": HTML,
  "index.html": "LIVE_HOME",
  "soft/index.html": "SOFT_HOME",
  "work/x/index.html": "LIVE_PAGE",
  "soft/work/y/index.html": "SOFT_PAGE",
  "_astro/app.abc.js": "LIVE_JS",
  "soft/_astro/app.def.js": "SOFT_JS",
};

describe("v3r soft overlay (#128)", () => {
  test("soft host: html soft hit wins over live root", async () => {
    const r = await worker.fetch(req("/", SOFT_HOST), makeEnv(MAP));
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("x-46009-soft"), "hit");
    assert.equal(r.headers.get("x-46009-worker"), "v3r");
    assert.match(await r.text(), /SOFT_HOME/);
  });

  test("soft host: non-html asset soft hit", async () => {
    const r = await worker.fetch(req("/_astro/app.def.js", SOFT_HOST), makeEnv(MAP));
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("x-46009-soft"), "hit");
    assert.equal(await r.text(), "SOFT_JS");
  });

  test("soft host: root fallback for keys absent from soft", async () => {
    const r = await worker.fetch(req("/work/x/", SOFT_HOST), makeEnv(MAP));
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("x-46009-soft"), "fallback");
    assert.match(await r.text(), /LIVE_PAGE/);
  });

  test("soft host: extensionless path resolves soft index.html", async () => {
    const r = await worker.fetch(req("/work/y", SOFT_HOST), makeEnv(MAP));
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("x-46009-soft"), "hit");
    assert.match(await r.text(), /SOFT_PAGE/);
  });

  test("live host: overlay never applies (no soft header, root bytes)", async () => {
    const r = await worker.fetch(req("/", LIVE_HOST), makeEnv(MAP));
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("x-46009-soft"), null);
    assert.match(await r.text(), /LIVE_HOME/);
  });

  test("live host: soft-deployed page NOT visible (stays live bytes)", async () => {
    const r = await worker.fetch(req("/work/y", LIVE_HOST), makeEnv(MAP));
    assert.equal(r.status, 404); // only soft/work/y exists; live root never consulted soft
  });

  test("promoted state (soft==root): both hosts serve identical origin bytes", async () => {
    const env = makeEnv({ "404.html": HTML, "index.html": "SAME", "soft/index.html": "SAME" });
    const a = await worker.fetch(req("/", SOFT_HOST), env);
    const b = await worker.fetch(req("/", LIVE_HOST), env);
    // injectAnalytics() legitimately differs per host (GA4 property, preview
    // FAB); the ORIGIN bytes are the prefix before the injected <style>.
    const origin = (t) => t.slice(0, t.indexOf("<style"));
    assert.equal(origin(await a.text()), origin(await b.text()));
    assert.equal(a.headers.get("x-46009-soft"), "hit"); // soft copy still served, identical content
  });

  test("soft namespace direct access is 404 on both hosts", async () => {
    for (const host of [SOFT_HOST, LIVE_HOST]) {
      const r = await worker.fetch(req("/soft/index.html", host), makeEnv(MAP));
      assert.equal(r.status, 404, `host=${host} status=${r.status}`);
    }
  });

  test("unknown host is 403 before any R2 read", async () => {
    const r = await worker.fetch(req("/", "evil.example"), makeEnv(MAP));
    assert.equal(r.status, 403);
  });

  test("POST to non-contact path is 405", async () => {
    const r = await worker.fetch(req("/", SOFT_HOST, "POST"), makeEnv(MAP));
    assert.equal(r.status, 405);
  });

  test("304 on etag match preserves soft tag", async () => {
    const r = await worker.fetch(
      new Request(`https://${SOFT_HOST}/`, { headers: { "if-none-match": `"soft/index.html"` } }),
      makeEnv(MAP),
    );
    assert.equal(r.status, 304);
    assert.equal(r.headers.get("x-46009-soft"), "hit");
  });
});
