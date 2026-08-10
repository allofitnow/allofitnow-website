// Work-grid hover card — the cursor-following plate ported from the reflow
// prototype (docs/prototypes/reflow-transition.html, #hovercard). It names the
// tile under the pointer: code, title + client/year, and roles, each on a
// cool-white box-decoration-break:clone plate. See HoverCard.astro for markup.
//
// The follow is LERPED, not locked — the lag is what makes it feel attached to
// something rather than glued to the pointer. On first appearance each line
// rises out of its clip mask, staggered on the brand ease.
//
// Bound once at import (the element is transition:persist, so it survives soft
// swaps). It shows over the things that fly to a project — work-grid tiles and
// the home bleed-carousel slides — and stays hidden while a flight is in
// progress, on touch devices, and while a pointer button is held (drag/press).

import { projects } from '@/data/projects';

const root = document.documentElement;
const getVar = (n: string) => getComputedStyle(root).getPropertyValue(n).trim();
const numVar = (n: string, f: number) => {
  const v = parseFloat(getVar(n));
  return Number.isNaN(v) ? f : v;
};
const canHover = () => matchMedia('(hover: hover) and (pointer: fine)').matches;
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const flighting = () => root.classList.contains('aoin-flighting');

// Build the per-tile copy once. scope ("LED / XR") splits into its own ragged
// items so the roles line reads like a real credit list.
//
// The title stacks two lines with a <br>, NOT block children: box-decoration-
// break:clone only paints the inline fragments, and a block child (e.g. a
// <div>/<i style=display:block>) escapes the inline, leaving its text with no
// plate behind it. A <br> keeps one inline box across two lines, so each line
// gets its own full ragged plate.
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
interface Card {
  code: string;
  titleHTML: string;
  caps: string;
}
const DATA = new Map<string, Card>(
  projects.map((p) => [
    p.slug,
    {
      code: p.code,
      titleHTML: `${esc(p.title)}<br>${esc(p.client)} — ${esc(p.year)}`,
      caps: [p.role, ...p.scope.split('/').map((s) => s.trim())].filter(Boolean).join(', '),
    },
  ]),
);

function init() {
  const card = document.getElementById('aoin-hovercard');
  if (!card) return;
  const elCode = card.querySelector<HTMLElement>('[data-hc="code"]');
  const elTitle = card.querySelector<HTMLElement>('[data-hc="title"]');
  const elCaps = card.querySelector<HTMLElement>('[data-hc="caps"]');
  if (!elCode || !elTitle || !elCaps) return;

  const HC = { x: 0, y: 0, tx: 0, ty: 0, on: false, raf: 0, slug: '' };

  function follow() {
    const k = numVar('--card-lerp', 0.18);
    HC.x += (HC.tx - HC.x) * k;
    HC.y += (HC.ty - HC.y) * k;
    card!.style.transform = `translate3d(${HC.x}px, ${HC.y}px, 0)`;
    HC.raf = requestAnimationFrame(follow);
  }

  function show(slug: string) {
    const d = DATA.get(slug);
    if (!d || HC.slug === slug) return;
    HC.slug = slug;
    elCode!.textContent = d.code;
    elTitle!.innerHTML = d.titleHTML;
    elCaps!.textContent = d.caps;
    if (HC.on) return; // tile→tile: swap copy, don't replay the reveal

    HC.on = true;
    card!.classList.add('on');
    HC.x = HC.tx; // snap to the pointer on first appearance
    HC.y = HC.ty;
    card!.style.transform = `translate3d(${HC.x}px, ${HC.y}px, 0)`;
    if (!reduced()) {
      const ease = getVar('--fly-ease');
      [...card!.children].forEach((g, i) => {
        const rise = g.firstElementChild as HTMLElement | null;
        rise?.animate(
          [{ transform: 'translateY(110%)' }, { transform: 'translateY(0)' }],
          { duration: 420, delay: i * 55, easing: ease, fill: 'both' },
        );
      });
    }
    if (!HC.raf) HC.raf = requestAnimationFrame(follow);
  }

  function hide() {
    if (!HC.on) return;
    HC.on = false;
    HC.slug = '';
    card!.classList.remove('on');
    cancelAnimationFrame(HC.raf);
    HC.raf = 0;
  }

  addEventListener(
    'pointermove',
    (e: PointerEvent) => {
      const off = numVar('--card-offset', 20);
      const r = card!.getBoundingClientRect();
      let x = e.clientX + off;
      let y = e.clientY + off;
      if (x + r.width > innerWidth - 12) x = e.clientX - r.width - off; // flip at the edges
      if (y + r.height > innerHeight - 12) y = e.clientY - r.height - off;
      HC.tx = x;
      HC.ty = Math.max(12, y);
    },
    { passive: true },
  );

  addEventListener('pointerover', (e: PointerEvent) => {
    // Skip while flighting, on touch, or with a button held — the home marquee
    // scrubs on a held pointer (e.buttons is set through a drag), and the card
    // shouldn't flicker in behind it.
    if (!canHover() || flighting() || e.buttons) return hide();
    // Work grid tiles AND the home bleed-carousel slides both fly to a project,
    // so both get the card.
    const t = (e.target as Element)?.closest?.('.tile[data-slug], .slide[data-slug]') as HTMLElement | null;
    if (!t) return hide();
    show(t.dataset.slug || '');
  });

  addEventListener('pointerdown', hide);
  addEventListener('blur', hide);
  // Never leave the card up through a page swap (e.g. clicking a tile to fly).
  document.addEventListener('astro:before-swap', hide);
}

init();
