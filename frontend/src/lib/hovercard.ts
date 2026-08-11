// Work-grid / home-marquee hover card — a cursor-following "VIEW PROJECT" plate
// whose label writes on character-by-character each time it appears. See
// HoverCard.astro for markup.
//
// The follow is LERPED, not locked — the lag is what makes it feel attached to
// something rather than glued to the pointer.
//
// Bound once at import (the element is transition:persist, so it survives soft
// swaps). It shows over the things that fly to a project — work-grid tiles and
// the home bleed-carousel slides — and stays hidden while a flight is in
// progress, on touch devices, and while a pointer button is held (drag/press).

const root = document.documentElement;
const getVar = (n: string) => getComputedStyle(root).getPropertyValue(n).trim();
const numVar = (n: string, f: number) => {
  const v = parseFloat(getVar(n));
  return Number.isNaN(v) ? f : v;
};
const canHover = () => matchMedia('(hover: hover) and (pointer: fine)').matches;
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const flighting = () => root.classList.contains('aoin-flighting');

function init() {
  const card = document.getElementById('aoin-hovercard');
  if (!card) return;
  const plate = card.querySelector<HTMLElement>('.plate');
  const chars = Array.from(card.querySelectorAll<HTMLElement>('.ch'));
  if (!plate || !chars.length) return;

  const HC = { x: 0, y: 0, tx: 0, ty: 0, on: false, raf: 0 };

  function follow() {
    const k = numVar('--card-lerp', 0.18);
    HC.x += (HC.tx - HC.x) * k;
    HC.y += (HC.ty - HC.y) * k;
    card!.style.transform = `translate3d(${HC.x}px, ${HC.y}px, 0)`;
    HC.raf = requestAnimationFrame(follow);
  }

  // The plate fades in (so there's never a blank box) while each letter rises
  // into place, staggered left-to-right on the brand ease — the "write on".
  function writeOn() {
    const ease = getVar('--fly-ease');
    plate!.getAnimations().forEach((a) => a.cancel());
    plate!.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160, easing: 'linear', fill: 'both' });
    chars.forEach((ch, i) => {
      ch.getAnimations().forEach((a) => a.cancel());
      ch.animate(
        [
          { opacity: 0, transform: 'translateY(0.3em)' },
          { opacity: 1, transform: 'translateY(0)' },
        ],
        { duration: 280, delay: i * 32, easing: ease, fill: 'both' },
      );
    });
  }

  function show() {
    if (HC.on) return; // moving tile→tile: keep it up, don't replay the write-on
    HC.on = true;
    card!.classList.add('on');
    HC.x = HC.tx; // snap to the pointer on first appearance
    HC.y = HC.ty;
    card!.style.transform = `translate3d(${HC.x}px, ${HC.y}px, 0)`;
    if (!reduced()) writeOn();
    if (!HC.raf) HC.raf = requestAnimationFrame(follow);
  }

  function hide() {
    if (!HC.on) return;
    HC.on = false;
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
    // Not while flighting, on touch, or with a button held (the home marquee
    // scrubs on a held pointer).
    if (!canHover() || flighting() || e.buttons) return hide();
    // Work grid tiles AND home bleed-carousel slides both fly to a project.
    const t = (e.target as Element)?.closest?.('.tile[data-slug], .slide[data-slug]');
    if (!t) return hide();
    show();
  });

  addEventListener('pointerdown', hide);
  addEventListener('blur', hide);
  // Never leave the card up through a page swap (e.g. clicking a tile to fly).
  document.addEventListener('astro:before-swap', hide);
}

init();
