# zaraz-worker-fallback/ -> 46009 routing layer (issue #50)

Status: REQUIRED routing layer (was: DORMANT fallback). Promoted 2026-08-29
by issue #50: R2 custom domains do not resolve directory or extensionless
URLs to index.html, so clean URLs 404 without this worker. Also the vehicle
for Zaraz injection (#32 Phase C) since serving now sits behind a zone route.

## What it does

- GET/HEAD only; everything else 405.
- Directory URLs (/ and any trailing-slash path) -> `<path>index.html`.
- Extensionless paths (Astro hrefs like /work/bad-bunny) -> retry
  `<path>/index.html` on miss. One retry, no fallback chains.
- Unknown paths stay 404 (site 404.html served where present).
- No body mutation, ever. ETag/304 passthrough. html=no-cache, assets 1d.

## Deploy / verify (issue #50 ACs)

    cd deploy/zaraz-worker-fallback
    npx wrangler@3 deploy            # routes 46009.someofitlater.com/* on zone someofitlater.com

AC battery (run from anywhere with curl):

    H=https://46009.someofitlater.com
    curl -s $H/ -o /tmp/root.html -w "%{http_code}\n"      # AC1: 200, md5 == /index.html md5
    curl -s $H/index.html -o /tmp/idx.html -w "%{http_code}\n" # AC3 explicit still works
    curl -s $H/work/ -o /dev/null -w "%{http_code}\n"      # AC2
    curl -s $H/work/bad-bunny -o /dev/null -w "%-headers\n"    # AC2 extensionless
    curl -s $H/nonexistent-$RANDOM/ -o /dev/null -w "%{http_code}\n" # AC4: 404
    md5sum /tmp/root.html /tmp/idx.html                    # AC5: equal

## Rollback

`npx wrangler@3 delete` or remove the route; bucket custom domain serving
resumes directly (index.html URLs keep working without the worker).

## Binding

R2 binding ASSETS -> bucket 46009. No body rewrite. No secrets.
