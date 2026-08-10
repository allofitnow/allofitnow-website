// Work / Home <-> Project flight — a faithful port of the reflow prototype's
// flyer engine, running on top of Astro's ClientRouter (for fetch/history/scroll)
// with the native View Transition neutralised (see styles/transitions.css).
//
// A REAL element flies the artwork — not a composited snapshot — animating its
// true width/height so `object-fit: cover` reframes it crisply. The page commits
// the swap PART WAY through the flight (--swap-at) so the destination assembles
// under the flyer, and the outgoing / incoming copy + tiles hard-cut out/in in a
// staggered top-to-bottom cascade.
//
// The flyer lives in a transition:persist layer (#aoin-flight-layer) so it keeps
// travelling across ClientRouter's DOM swap. The initial destination rect is an
// approximation from layout tokens; once the destination is live (after-swap) the
// flyer is RE-TARGETED to the element's real measured rect, so it always lands
// pixel-exact regardless of section labels, scrollbars, breakpoints, etc.

import { projects } from '@/data/projects';

const ORDER = projects.map((p) => p.slug);

const root = document.documentElement;
const cssVar = (n: string) => getComputedStyle(root).getPropertyValue(n).trim();
const numVar = (n: string, f: number) => {
  const v = parseFloat(cssVar(n));
  return Number.isNaN(v) ? f : v;
};
const isWorkPath = (p: string) => /^\/work\/?$/.test(p);
const isProjectPath = (p: string) => /^\/work\/[^/]+\/?$/.test(p);
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
  radius: string;
}

function layer() {
  return document.getElementById('aoin-flight-layer');
}

// The element on the CURRENT page that should fly, plus its live rect + image.
function source(toPath: string, sourceEl: Element | undefined) {
  let el: Element | null = null;
  if (isProjectPath(toPath)) el = sourceEl?.closest?.('a[data-slug]') ?? null;
  else if (isWorkPath(toPath)) el = document.querySelector('.hero[data-slug]');
  if (!el) return null;
  const img = el.querySelector('img');
  if (!img) return null;
  const r = img.getBoundingClientRect();
  if (!r.width || !r.height) return null;
  return {
    el,
    slug: el.getAttribute('data-slug') || '',
    src: (img as HTMLImageElement).currentSrc || (img as HTMLImageElement).src,
    from: { left: r.left, top: r.top, width: r.width, height: r.height, radius: getComputedStyle(el).borderRadius } as Rect,
  };
}

// Approximate destination rect from the layout tokens — just enough to aim the
// flyer the right way for the first ~half; after-swap re-targets it precisely.
function approxDest(toPath: string, slug: string): Rect | null {
  const vw = root.clientWidth; // excludes the scrollbar
  const vh = innerHeight;
  const radius = cssVar('--hero-radius') || '12px';

  if (isProjectPath(toPath)) {
    const w = vw * (numVar('--hero-w', 95) / 100);
    return { left: (vw - w) / 2, top: vh * (numVar('--hero-pad-top', 18) / 100), width: w, height: vh * (numVar('--hero-height', 72) / 100), radius };
  }

  const idx = ORDER.indexOf(slug);
  if (idx < 0) return null;
  const side = vw <= 560 ? numVar('--margin-edge-mobile', 20) : numVar('--margin-edge', 48);
  const gap = numVar('--tile-gap', 12);
  const cols = vw <= 560 ? 1 : vw <= 900 ? 2 : 3;
  const colW = (vw - 2 * side - (cols - 1) * gap) / cols;
  const tileH = (colW * 3) / 4;
  const topPad = vh * (numVar('--work-pad-top', 24) / 100) + 42; // + section label
  const rowN = Math.floor(idx / cols);
  const colN = idx % cols;
  return { left: side + colN * (colW + gap), top: topPad + rowN * (tileH + gap), width: colW, height: tileH, radius: cssVar('--tile-radius') || '12px' };
}

// Live rect of an element's image (for measuring the real destination).
function rectOf(el: Element): Rect {
  const img = el.querySelector('img') || el;
  const r = img.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height, radius: getComputedStyle(el).borderRadius };
}

function keyframes(a: Rect, b: Rect) {
  return [
    { transform: `translate(${a.left}px, ${a.top}px)`, width: `${a.width}px`, height: `${a.height}px`, borderRadius: a.radius },
    { transform: `translate(${b.left}px, ${b.top}px)`, width: `${b.width}px`, height: `${b.height}px`, borderRadius: b.radius },
  ];
}

function makeFlyer(src: string, from: Rect) {
  const host = layer();
  if (!host) return null;
  const f = document.createElement('div');
  f.className = 'aoin-flyer';
  f.style.width = `${from.width}px`;
  f.style.height = `${from.height}px`;
  f.style.transform = `translate(${from.left}px, ${from.top}px)`;
  f.style.borderRadius = from.radius;
  const img = document.createElement('img');
  img.src = src;
  img.alt = '';
  f.appendChild(img);
  host.appendChild(f);
  return f;
}

// [data-unit] copy + grid tiles (never the marquee) — the things that hard-cut.
function sweepItems(exceptSlug: string) {
  const units = Array.from(document.querySelectorAll<HTMLElement>('[data-unit]'));
  const tiles = Array.from(document.querySelectorAll<HTMLElement>('#grid [data-slug]')).filter(
    (el) => el.getAttribute('data-slug') !== exceptSlug,
  );
  return [...units, ...tiles];
}
// Randomised stagger: evenly-spaced time slots, shuffled into a random order,
// each nudged by a little jitter — so the hard cut scatters instead of marching
// strictly top-to-bottom. Returns one delay per item, aligned to the input order.
function scatter(count: number, step: number, base = 0): number[] {
  const slots = Array.from({ length: count }, (_, i) => base + i * step);
  for (let i = slots.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [slots[i], slots[j]] = [slots[j], slots[i]];
  }
  return slots.map((d) => Math.max(base, d + (Math.random() - 0.5) * step * 0.9));
}

interface Active {
  slug: string;
  flyer: HTMLElement | null;
  flight: Animation | null;
}
let active: Active | null = null;

document.addEventListener('astro:before-preparation', (e: any) => {
  const toPath: string = e.to?.pathname ?? '';
  if (reduced() || (!isProjectPath(toPath) && !isWorkPath(toPath))) return;

  const dur = numVar('--fly-dur', 940);
  const ease = cssVar('--fly-ease');
  const swapAt = Math.min(1, Math.max(0, numVar('--swap-at', 0.55)));

  root.classList.add('aoin-flighting'); // lock scroll for the flight
  const src = source(toPath, e.sourceElement);
  active = { slug: src?.slug ?? '', flyer: null, flight: null };

  // The flyer — the real artwork travelling from source rect toward the dest.
  if (src) {
    const to = approxDest(toPath, src.slug);
    if (to) {
      const f = makeFlyer(src.src, src.from);
      if (f) {
        active.flyer = f;
        active.flight = f.animate(keyframes(src.from, to), { duration: dur, easing: ease, fill: 'both' });
        (src.el as HTMLElement).style.visibility = 'hidden'; // the real source steps aside
      }
    }
  }

  // Outgoing copy + tiles: each rises a touch on the brand ease and then cuts,
  // scattered (randomised) so they don't leave in strict order. The visibility
  // "pop" stays — the translation is layered on top of it.
  const shift = numVar('--sweep-shift', 44);
  const exitMove = Math.round(numVar('--enter-dur', 650) * 0.36);
  const outItems = sweepItems(src?.slug ?? '').filter((el) => el !== src?.el);
  const outDelays = scatter(outItems.length, numVar('--exit-stagger', 40));
  outItems.forEach((el, i) => {
    const d = outDelays[i];
    el.animate(
      [{ transform: 'translateY(0)' }, { transform: `translateY(-${shift}px)` }],
      { duration: exitMove, delay: d, easing: ease, fill: 'forwards' },
    );
    setTimeout(() => (el.style.visibility = 'hidden'), d + exitMove);
  });

  // Commit the swap part-way through the flight — but only when a flyer is
  // actually travelling. With no shared element (e.g. the nav/cue WORK link from
  // home) there's nothing to cover the wait, so swap right away and let the
  // destination hard-cut its copy in.
  if (active.flyer) {
    const orig = e.loader;
    e.loader = async () => {
      await Promise.all([orig(), sleep(dur * swapAt)]);
    };
  }
});

document.addEventListener('astro:after-swap', () => {
  const a = active;
  active = null;
  if (!a) {
    root.classList.remove('aoin-flighting');
    return;
  }

  const dur = numVar('--fly-dur', 940);
  const ease = cssVar('--fly-ease');
  const enterDelay = numVar('--enter-delay', 80);
  const enterStagger = numVar('--enter-stagger', 60);
  const enterDur = numVar('--enter-dur', 650);
  const shift = numVar('--sweep-shift', 44);

  // The destination's own copy of the flying element stays hidden until the flyer
  // touches down, so there is never two of it.
  const destShared = a.slug ? document.querySelector<HTMLElement>(`[data-slug="${a.slug}"]`) : null;
  if (destShared) destShared.style.visibility = 'hidden';

  // Re-target the flyer to the destination's REAL measured rect (the initial aim
  // was a token approximation). Steer the remaining travel from where it is now.
  if (a.flyer && a.flight && destShared) {
    const real = rectOf(destShared);
    const fr = a.flyer.getBoundingClientRect();
    const cur: Rect = { left: fr.left, top: fr.top, width: fr.width, height: fr.height, radius: getComputedStyle(a.flyer).borderRadius };
    const elapsed = typeof a.flight.currentTime === 'number' ? a.flight.currentTime : dur * 0.55;
    const remaining = Math.max(140, dur - elapsed);
    // Pin the flyer to its current visual state so cancel() doesn't snap it back.
    a.flyer.style.width = `${cur.width}px`;
    a.flyer.style.height = `${cur.height}px`;
    a.flyer.style.transform = `translate(${cur.left}px, ${cur.top}px)`;
    a.flyer.style.borderRadius = cur.radius;
    try {
      a.flight.cancel();
    } catch {
      /* already done */
    }
    a.flight = a.flyer.animate(keyframes(cur, real), { duration: remaining, easing: ease, fill: 'both' });
  }

  // Destination copy + tiles arrive under the travelling flyer: each pops in and
  // rises from just below into place on the brand ease, scattered (randomised).
  const items = sweepItems(a.slug);
  items.forEach((el) => (el.style.visibility = 'hidden'));
  const delays = scatter(items.length, enterStagger, enterDelay);
  items.forEach((el, i) => {
    setTimeout(() => {
      el.style.visibility = 'visible';
      const anim = el.animate(
        [{ transform: `translateY(${shift}px)` }, { transform: 'translateY(0)' }],
        { duration: enterDur, easing: ease, fill: 'both' },
      );
      anim.finished
        .then(() => {
          el.style.transform = '';
          anim.cancel();
        })
        .catch(() => {});
    }, delays[i]);
  });

  const land = () => {
    if (destShared) destShared.style.visibility = '';
    a.flyer?.remove();
    root.classList.remove('aoin-flighting');
  };
  if (a.flight) a.flight.finished.then(land).catch(land);
  else land();
});
