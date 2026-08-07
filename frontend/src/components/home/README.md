# src/components/home — home page components (phase 1, pending)

The single-page home prototype, split at its natural seams. Markup lifts from the
prototype with inline styles moved into each component's scoped `<style>`; values
stay identical (verify against the running prototype — motion does not survive a
static frame).

Planned split, top to bottom:

- **`Preloader.astro`** — LOADING counter → 0–100, clears frame
- **`Nav.astro`** — logo, link columns, LA clock, mobile MENU overlay
- **`Hero.astro`** — 4-word intro lockup assembly, scroll-scrubbed reel reveal, scroll cue
- **`About.astro`** — WE INNOVATE / VISUAL EXPERIENCES display + dropcap statement
- **`BleedCarousel.astro`** — draggable artist strip (maps to the projects marquee relationship)
- **`Services.astro`** — four capabilities, hover-expand panels
- **`Clients.astro`** — justified selected-clients roster (line-break solver)
- **`Footer.astro`** — info / nav / social / studio grid + full-bleed wordmark

Shared atmosphere (film grain, foot bar) and the animation logic live in
`@/lib/home.controller.ts`, not inline per component.
