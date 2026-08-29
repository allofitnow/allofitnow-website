# Zaraz Worker Fallback (gate-conditional, never eager)

Status: DORMANT. Deploys ONLY if the section 7 empirical gate fails.

## Decision gate (production-delivery spec section 7)

The check is empirical: after zone ACTIVE + `46009.someofitlater.com` attached,
fetch a real HTML page through the proxied custom domain and look for Zaraz
script injection (a `<script>` tag whose src host is `system.cloudflare.com`
or `zaraz.cloudflarelabs.com`, or any script whose src contains `/zaraz/i`).

- Injection present -> direct R2 custom domain serving is final. Delete this
  directory's deploy intent; keep it as reference.
- Injection absent -> activate this Worker (below). The route intercepts all
  custom-domain traffic, passes it to the bucket, and lets the edge inject.

## Activation steps (operator, ~5 min)

1. `cd deploy/zaraz-worker-fallback`
2. `npx wrangler deploy` (uses `wrangler.toml`: route `46009.someofitlater.com/*`,
   R2 binding ASSETS -> bucket `46009`)
3. Verify: `curl -sI https://46009.someofitlater.com/ | grep -i x-46009-worker`
   -> header `x-46009-worker: v1` proves the Worker is in the path.
4. Re-check Zaraz injection (same grep as the gate). Worker-in-path + edge
   features on the route -> injection should now fire.
5. Record outcome in the tracking ledger issue + `deploy/logs/` note.

## Why not always-on

Minimal-infra ethos: direct R2 custom domain serving is the cheapest path
(zero compute, zero worker invocations). The Worker adds a per-request compute
hop and a second surface to maintain. It exists as a ready artifact so the
gate decision is a 5-minute activation, not a build project.

## Cost note

Workers free tier: 100k req/day. Portfolio traffic profile (NYC B2B, 6,854
events/90d default events -> low RPS) is far below. Paid plan not required.

## Headers policy

- HTML: `cache-control: no-cache` (frequent publishes, small set)
- Assets/media: `public, max-age=86400` (hashed assets re-validate via ETag;
  media immutable in practice; 24h cap bounds staleness after tombstones)
- `x-46009-worker: v1` on every response - the in-path proof header.

## Rollback

Remove the route from the dashboard (or `wrangler delete`), traffic falls
back to direct R2 custom domain. Nothing else changes.
