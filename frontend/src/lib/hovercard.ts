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
  if (!plate) return;

  const HC = { x: 0, y: 0, tx: 0, ty: 0, on: false, raf: 0, key: '' };
  const VIEW = 'VIEW PROJECT';

  function follow() {
    const k = numVar('--card-lerp', 0.18);
    HC.x += (HC.tx - HC.x) * k;
    HC.y += (HC.ty - HC.y) * k;
    card!.style.transform = `translate3d(${HC.x}px, ${HC.y}px, 0)`;
    HC.raf = requestAnimationFrame(follow);
  }

  // A key for the current content: work tiles all read 'v' (one shared VIEW
  // PROJECT label, so hovering tile→tile never replays); home slides key by
  // slug, so moving slide→slide re-renders the new project's card.
  const richTarget = (t: Element) => t.matches('.slide[data-title]');
  function keyFor(t: Element) {
    return richTarget(t) ? 'r:' + (t.getAttribute('data-slug') || '') : 'v';
  }

  // Fill the plate for the hovered target: the rich project card on the home
  // bleed slides, the plain VIEW PROJECT label everywhere else (work grid).
  function render(t: Element) {
    const rich = richTarget(t);
    plate!.classList.toggle('rich', rich);
    plate!.replaceChildren();
    if (rich) {
      const line = (cls: string, text: string) => {
        if (!text) return;
        const s = document.createElement('span');
        s.className = 'hc-line ' + cls;
        s.textContent = text;
        plate!.appendChild(s);
      };
      line('hc-title', t.getAttribute('data-title') || '');
      line('hc-tour', t.getAttribute('data-tour') || '');
      // Capabilities are pipe-joined; each becomes its own highlighted line.
      (t.getAttribute('data-caps') || '').split('|').forEach((c) => line('hc-caps', c.trim()));
    } else {
      for (const c of VIEW) {
        const s = document.createElement('span');
        s.className = 'ch';
        s.textContent = c; // plate is white-space:pre, so the space is kept
        plate!.appendChild(s);
      }
    }
  }

  // The plate fades in (so there's never a blank box) while each unit rises into
  // place, staggered on the brand ease — the "write on". Units are the letters
  // (VIEW PROJECT) or the stacked lines (rich card).
  function writeOn() {
    const ease = getVar('--fly-ease');
    const rich = plate!.classList.contains('rich');
    const units = Array.from(
      plate!.querySelectorAll<HTMLElement>(rich ? '.hc-line' : '.ch'),
    );
    const step = rich ? 70 : 32;
    const dur = rich ? 320 : 280;
    plate!.getAnimations().forEach((a) => a.cancel());
    plate!.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160, easing: 'linear', fill: 'both' });
    units.forEach((el, i) => {
      el.getAnimations().forEach((a) => a.cancel());
      el.animate(
        [
          { opacity: 0, transform: 'translateY(0.3em)' },
          { opacity: 1, transform: 'translateY(0)' },
        ],
        { duration: dur, delay: i * step, easing: ease, fill: 'both' },
      );
    });
  }

  function show(t: Element) {
    const key = keyFor(t);
    if (HC.on && key === HC.key) return; // same content: keep it up, don't replay
    const first = !HC.on;
    HC.on = true;
    HC.key = key;
    card!.classList.add('on');
    render(t);
    if (first) {
      HC.x = HC.tx; // snap to the pointer on first appearance
      HC.y = HC.ty;
      card!.style.transform = `translate3d(${HC.x}px, ${HC.y}px, 0)`;
    }
    if (!reduced()) writeOn();
    if (!HC.raf) HC.raf = requestAnimationFrame(follow);
  }

  function hide() {
    if (!HC.on) return;
    HC.on = false;
    HC.key = '';
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
    show(t);
  });

  addEventListener('pointerdown', hide);
  addEventListener('blur', hide);
  // Never leave the card up through a page swap (e.g. clicking a tile to fly).
  document.addEventListener('astro:before-swap', hide);
}

init();
