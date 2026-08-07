# Prototypes — ground truth

These are the canonical references for the build. When they disagree with
anything else, they win. Motion does not survive a static frame — open them in a
browser to judge it.

## `home-standalone.html`

The full home page, built in Claude Design (React + `dc-runtime`). Self-contained
bundle — the real source rides inside `__bundler/template` / `__bundler/manifest`
script tags; open the page in a browser to see it rendered, or unpack the
template to read the markup + the `DCLogic` animation class.

Ported into `frontend/` component-by-component (phase 1). Fonts, artist stills,
and brand SVGs have already been extracted from its manifest into
`frontend/public/`.

## `reflow-transition.html`

The clone-and-fly page-transition flow, wired across home → work → project views,
with a live tuning panel. This is the **source for `frontend/src/lib/flight.js`** —
extracting the engine into a clean framework-agnostic module is phase-2 work,
done with this open so the feel is verified, not guessed.

Dialed values live in its `:root` (`--fly-dur` 940ms, `--swap-at` .55, the brand
curve, exit lead/ease, enter timings, tile/hero radius 12px, hero 95% × 72vh).
Load-bearing, do not rename: `data-slug`, `data-unit`, the `.mask` wrapper, and
radius placement (same element in tile and hero, or the corner pops mid-flight).
