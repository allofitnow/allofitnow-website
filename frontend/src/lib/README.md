# src/lib — framework-agnostic controllers

Plain ES modules, no Astro/React. Attached to pages from a `<script>` in the
component that owns the markup.

- **`flight.js`** — the clone-and-fly page-transition engine, extracted from the
  reflow transition prototype. Framework-agnostic on purpose so it can be wired
  into Astro's `<ClientRouter />` lifecycle in phase 2. Do not rename `data-slug`,
  `data-unit`, the `.mask` wrapper, or move the radius off its element — those are
  load-bearing.
- **`home.controller.ts`** _(phase 1, pending)_ — the home page's `DCLogic` class
  rewritten to plain DOM: `ref="{{x}}"` → `querySelector`, `props` → data/consts,
  `sc-camel-on-*` → `addEventListener`. Owns the preloader, intro lockup,
  scroll-scrubbed hero reel, drag carousel, services accordion, clients roster,
  and footer reveals.
