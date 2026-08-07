# backend — Payload CMS (phase 2)

Intentionally empty until the home page is ported and verified against the
prototype. Payload 3 is Next-native — it runs as its own app here (not inside
Astro) and the Astro frontend consumes its REST/GraphQL API. Two deployments.

Sequencing (from the handoff — do not model the CMS first):

1. Home → Astro, content hardcoded in `frontend/src/data` but shaped as data.
2. Only then scaffold Payload here, mirroring shapes that already work.

Planned collections: `projects`, `homepage` (global), `services` (page,
blocks scoped to this page only), `settings` (global). `projects.code` is a
**stored** field written by a `beforeChange` hook, not derived at render.
