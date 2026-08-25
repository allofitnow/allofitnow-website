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

## `clients-falloff.html`

Tuning rig for the SELECTED CLIENTS hover behaviour. The maths matches
`components/home/Clients.astro`; the sliders exist because floor / radius /
jitter are taste, not logic. When a setting reads better than the shipped one,
copy the numbers across — the panel prints them in the shape of the `TUNE`
object in that component.

The scroll-driven reveal is deliberately NOT reproduced here. It owns `opacity`
on the real page, which is exactly why the falloff rides on colour alpha
instead — a CSS `opacity` would lose to the running animation. Every name in the
rig starts revealed so the falloff can be judged on its own.

## `writeup-panel.html`

The PROJECT INFO panel at both column settings, at the real panel measure
(46vw = 883px on a 1920 display). Unlike the other two, this one is
**generated, not authored**: the CSS is lifted verbatim out of
`ProjectPage.astro` (every `.pp__notesRich` rule, `:global()` unwrapped) and the
prose is the actual output of `lib/richtext.ts` run over the live ARCANE / RIOT
UNDERCITY NIGHTS write-up. If it looks right, the shipped code is what made it
look right. Regenerate rather than hand-edit.

The full-width figure in it is an `upload` node someone inserted in the CMS long
before the serializer knew what to do with one — it was dropped silently until
now. The clip and its caption below are the per-insert options (span, caption).
