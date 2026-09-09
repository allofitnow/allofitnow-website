/* Site-wide idle field — the ambient character field behind every Base.astro page.
 *
 * A sparse, spread-out grid of mono glyphs with the service names sprinkled through it as
 * whole words. It is the page's IDLE state: it starts hidden and drifts in only once the page
 * has been left alone; while up it idles (a slow flicker + a gentle per-glyph breathe) and
 * displaces around the cursor as you move; after a beat of activity (mouse or scroll) it comes
 * apart — every glyph drifts off in its own direction and fades on its own random timing — and
 * drifts back in once the page is still again. Pure DOM: at this sparsity it is a few hundred spans, which is cheaper and
 * simpler than a second WebGL field (the one on /services stays as it is).
 *
 * The grid is built client-side, sized to the viewport, and rebuilt on resize. Reduced-motion
 * users get no field at all; touch devices get the idle field without the pointer behaviour.
 * The element itself is transition:persist'd in Base.astro, so the field is continuous across
 * soft navigation — init is guarded per element. */

const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-/';

// Field geometry (matches the CSS in IdleField.astro): 12.5px mono at 1.15em tracking on
// 52px lines. Advance ≈ glyph (~0.6em) + tracking; cols/rows are generous and overflow clips.
const FONT_PX = 12.5;
const ADVANCE = FONT_PX * (0.6 + 1.15);
const LINE = 52;
const DENSITY = 0.11;         // fraction of cells lit
const DENSITY_PHONE = 0.08;
const WORD_A = 0.92;          // the names' base brightness
const WORD_TRACK_DIFF = 0.87; // em: field tracking 1.15 − word tracking 0.28

// Cursor pocket: a circle of R px; the inner CORE fully clears, the ring scatters outward.
const R = 170, CORE = 0.42, SCATTER = 84;
// The field is an IDLE state: it starts hidden and only drifts in once the page has been left
// alone (FIRST_IDLE after load, IDLE_AFTER after any later activity). Keep moving (mouse or
// scroll) for HIDE_AFTER and it scatters away again. RETURN_MS covers the longest beat + drift.
// Idle means idle: a reading pause is several seconds, so the waits sit well past one.
const FIRST_IDLE = 10000, HIDE_AFTER = 1300, IDLE_AFTER = 8000, RETURN_MS = 1750;

type Rand = { ux: number; uy: number; mag: number; spin: number; delay: number };

export function initIdleField(root: HTMLElement, words: string[]): void {
  if ((root as any).__idleField) return;
  (root as any).__idleField = true;
  if (typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const finePointer = typeof matchMedia !== 'undefined' && matchMedia('(hover: hover) and (pointer: fine)').matches;

  let built = false;
  let spans: HTMLElement[] = [];
  let plain: HTMLElement[] = [];
  let rand: Rand[] = [];
  let centres: { x: number; y: number }[] = [];
  let active = new Set<number>();

  /* ------------------------------------------------------------------ build */
  const build = () => {
    const w = root.clientWidth, h = root.clientHeight;
    if (w < 40 || h < 40) return;
    const cols = Math.ceil((w - 96) / ADVANCE) + 2;
    const rows = Math.ceil((h - 80) / LINE) + 2;
    const density = w < 768 ? DENSITY_PHONE : DENSITY;

    type Cell = { g: string; on: boolean; w: boolean; sp: boolean; last: boolean; wlen: number };
    const grid: Cell[][] = [];
    for (let r = 0; r < rows; r++) {
      const row: Cell[] = [];
      for (let c = 0; c < cols; c++) {
        row.push({ g: GLYPHS[(Math.random() * GLYPHS.length) | 0], on: Math.random() < density, w: false, sp: false, last: false, wlen: 0 });
      }
      grid.push(row);
    }
    // The names: one per row at most, never on adjacent rows, anywhere they fit.
    const used = new Set<number>();
    const pool = words.slice().sort(() => Math.random() - 0.5);
    for (const word of pool) {
      if (word.length + 2 > cols) continue;
      let r = -1;
      for (let t = 0; t < 40 && r < 0; t++) {
        const cand = 1 + ((Math.random() * (rows - 2)) | 0);
        if (!used.has(cand) && !used.has(cand - 1) && !used.has(cand + 1)) r = cand;
      }
      if (r < 0) continue;
      used.add(r);
      const c0 = (Math.random() * (cols - word.length - 2)) | 0;
      for (let k = 0; k < word.length; k++) {
        const cell = grid[r][c0 + k];
        cell.g = word[k]; cell.on = true; cell.w = true; cell.sp = word[k] === ' ';
        cell.last = k === word.length - 1; cell.wlen = word.length;
      }
    }

    const frag = document.createDocumentFragment();
    const nextSpans: HTMLElement[] = [];
    for (let r = 0; r < rows; r++) {
      const rowEl = document.createElement('div');
      rowEl.className = 'if-row';
      let text = '';
      const flush = () => { if (text) { rowEl.appendChild(document.createTextNode(text)); text = ''; } };
      for (let c = 0; c < cols; c++) {
        const cell = grid[r][c];
        if (!cell.on) { text += ' '; continue; }
        flush();
        const s = document.createElement('span');
        s.className = cell.w ? 'if-g if-w' + (cell.sp ? ' if-sp' : '') + (cell.last ? ' if-wl' : '') : 'if-g';
        s.textContent = cell.g;
        const a = cell.w ? WORD_A : 0.35 + Math.random() * 0.45;
        const st = s.style;
        st.setProperty('--dur', (4 + Math.random() * 5).toFixed(2) + 's');
        st.setProperty('--del', (-Math.random() * 9).toFixed(2) + 's');
        st.setProperty('--a', a.toFixed(2));
        st.setProperty('--dd', ((Math.random() * 900) | 0) + 'ms');
        st.setProperty('--dx', ((Math.random() * 2 - 1) * 46).toFixed(1) + 'px');
        st.setProperty('--dy', ((Math.random() * 2 - 1) * 34).toFixed(1) + 'px');
        st.setProperty('--rot', ((Math.random() * 2 - 1) * 40).toFixed(1) + 'deg');
        if (cell.last) st.setProperty('--wpad', (cell.wlen * WORD_TRACK_DIFF).toFixed(2) + 'em');
        rowEl.appendChild(s);
        nextSpans.push(s);
      }
      flush();
      frag.appendChild(rowEl);
    }
    if (!built) root.setAttribute('data-hidden', ''); // mount already dissolved: no first-paint flash
    built = true;
    root.replaceChildren(frag);
    spans = nextSpans;
    plain = spans.filter((s) => !s.classList.contains('if-w'));
    rand = spans.map(() => {
      const ang = Math.random() * Math.PI * 2;
      return { ux: Math.cos(ang), uy: Math.sin(ang), mag: 0.6 + Math.random() * 0.9, spin: (Math.random() * 2 - 1) * 45, delay: (Math.random() * 110) | 0 };
    });
    active = new Set();
    cache();
  };

  const cache = () => {
    centres = spans.map((s) => { const r = s.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  };

  /* ------------------------------------------------------- cursor pocket */
  const reset = (i: number) => {
    const s = spans[i]; if (!s) return;
    s.style.transitionDelay = (rand[i].delay >> 1) + 'ms';
    s.style.transform = ''; s.style.opacity = ''; s.style.animation = '';
  };
  const clear = () => { active.forEach(reset); active = new Set(); };

  const displace = (mx: number, my: number) => {
    const next = new Set<number>();
    for (let i = 0; i < spans.length; i++) {
      const c = centres[i]; if (!c) continue;
      const dx = c.x - mx, dy = c.y - my;
      const d = Math.hypot(dx, dy);
      if (d < R) {
        const f = 1 - d / R;
        const e = f * f * (3 - 2 * f);
        const j = rand[i];
        const ol = d || 1;
        let vx = (dx / ol) * 0.8 + j.ux * 0.5, vy = (dy / ol) * 0.8 + j.uy * 0.5;
        const vl = Math.hypot(vx, vy) || 1; vx /= vl; vy /= vl;
        const dist = SCATTER * (0.35 + 0.65 * e) * j.mag;
        const s = spans[i];
        s.style.animation = 'none';
        s.style.transitionDelay = j.delay + 'ms';
        s.style.transform = 'translate(' + (vx * dist).toFixed(1) + 'px,' + (vy * dist).toFixed(1) + 'px) rotate(' + (j.spin * e).toFixed(1) + 'deg)';
        s.style.opacity = d < R * CORE ? '0' : (1 - Math.min(1, e * 2.2) * 0.98).toFixed(3);
        next.add(i);
      }
    }
    active.forEach((i) => { if (!next.has(i)) reset(i); });
    active = next;
  };

  /* --------------------------------------------- idle → moving → idle state */
  // hidden: the field is (dissolving) away. activeSince: start of the current burst of activity,
  // 0 when the page is idle. shown: it has drifted in at least once (the first wait is longer).
  let lastMove = performance.now(), activeSince = 0, hidden = true, shown = false, lastRun = 0, returnT = 0;
  const activity = () => {
    const now = performance.now();
    if (!activeSince) { activeSince = now; clearTimeout(returnT); root.removeAttribute('data-returning'); }
    lastMove = now;
    if (!hidden && now - activeSince > HIDE_AFTER) { hidden = true; root.setAttribute('data-hidden', ''); }
  };
  if (finePointer) {
    window.addEventListener('pointermove', (ev) => {
      if (!active.size) cache();              // positions can shift as fonts land; re-read per burst
      activity();
      const now = performance.now();
      if (!hidden && now - lastRun > 14) { lastRun = now; displace(ev.clientX, ev.clientY); }
    }, { passive: true });
  }
  // Scrolling is activity too (any device): the field belongs to a page that is being left alone.
  window.addEventListener('scroll', activity, { passive: true });
  window.addEventListener('wheel', activity, { passive: true });
  window.addEventListener('touchmove', activity, { passive: true });
  setInterval(() => {
    const idleFor = performance.now() - lastMove;
    if (activeSince && idleFor > IDLE_AFTER) { activeSince = 0; clear(); }
    if (hidden && !activeSince && idleFor > (shown ? IDLE_AFTER : FIRST_IDLE) && spans.length) {
      hidden = false; shown = true;
      root.removeAttribute('data-hidden');
      root.setAttribute('data-returning', '');
      clearTimeout(returnT);
      returnT = window.setTimeout(() => root.removeAttribute('data-returning'), RETURN_MS);
    }
  }, 100);

  /* ----------------------------------------------------------- idle flicker */
  setInterval(() => {
    if (document.hidden || !plain.length) return;
    const k = Math.max(2, (plain.length * 0.015) | 0);
    for (let n = 0; n < k; n++) {
      const s = plain[(Math.random() * plain.length) | 0];
      if (s && !s.style.transform) s.textContent = GLYPHS[(Math.random() * GLYPHS.length) | 0];
    }
  }, 260);

  /* ------------------------------------------------------------ lifecycle */
  let rz = 0;
  window.addEventListener('resize', () => { clearTimeout(rz); rz = window.setTimeout(build, 200); });
  build();
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(cache);
    document.fonts.addEventListener('loadingdone', cache);
  }
  setTimeout(cache, 1600);
}
