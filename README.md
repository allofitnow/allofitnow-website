# All Of It Now — website

Redesign and rebuild of the AOIN (All Of It Now) site — an LA real-time content
and show production studio. **Astro frontend, Payload CMS backend, two
deployments.**

## Repo shape

```
allofitnow-website-ss26/          # repo root
├─ frontend/                      # Astro app (this is where the build lives now)
│  ├─ public/
│  │  ├─ fonts/                   # brand OTFs: Denim INK WD, SN Ja Mono, OO Theran
│  │  └─ assets/                  # artist stills, AOIN icon / logo / wordmark
│  └─ src/
│     ├─ styles/tokens.css        # dialed :root token blocks + @font-face
│     ├─ lib/                     # framework-agnostic controllers (flight.js, home.controller)
│     ├─ data/                    # hardcoded, Payload-shaped content (phase 1)
│     ├─ layouts/Base.astro
│     ├─ components/home/         # home page, split at its seams
│     └─ pages/                   # index.astro (+ work, services … later)
└─ backend/                       # Payload (Next) — empty until phase 2
```

The two apps deploy independently and share only a REST/GraphQL contract, so
they're plain sibling folders — no workspace tooling until there's shared code
to justify it.

## Sequencing

1. **Home → Astro**, content hardcoded but shaped as data. Proves the component
   seams with no CMS in the loop.
2. **Swap the data source to Payload.** Collections mirror shapes already working.

Do not model Payload first.

## The flight transition

The clone-and-fly page transition is the product on this site — it does not
survive a static comp. The engine is extracted as a framework-agnostic module
(`frontend/src/lib/flight.js`) and gets wired into Astro's `<ClientRouter />`
lifecycle in phase 2, gated on `Promise.all([flightTimer, loader()])`. Hover
prefetch is a requirement, not an optimisation — it's on in `astro.config.mjs`.

Load-bearing, do not rename or restructure: `data-slug`, `data-unit`, the
`.mask` wrapper, and radius placement (same element in tile and hero).

## Local dev

```bash
cd frontend
npm install
npm run dev
```

> Node is at `C:\Program Files\nodejs` on the build machine but not always on
> PATH — prepend it if `node`/`npm` aren't found.
