/* AOIN — Project page behaviour. Ported from the design handoff
 * (project-page.spec.md); every constant is the value the design was approved
 * at. One boolean drives the layout; JS only supplies the four measured values
 * the CSS can't compute (spec §4) plus the word-reveal and next-project plate.
 *
 * Adapted for our app: the page runs under the ClientRouter, so the module boots
 * per navigation (guarded by dataset.booted) and tears its listeners down on
 * astro:before-swap. The fixed chrome is aligned to our capped --content-max
 * frame (--pp-edge / --pp-panel-w) rather than the raw viewport.
 */

const EASE_REVEAL = 'cubic-bezier(0.05, 0.89, 0, 0.99)';
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export function initProjectPage(root: HTMLElement) {
  if (!root || root.dataset.booted) return;
  root.dataset.booted = '1';

  const q = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel);

  const frame = q('[data-pp-frame]')!;
  // The toggle is now the ProjectBar's PROJECT INFO button ([data-pp-toggle]).
  // Its label is a CSS ride (PROJECT INFO <-> CLOSE), so the old text-swap target
  // is optional — guard the write below.
  const toggle = q('[data-pp-toggle]')!;
  const toggleLabel = q('[data-pp-toggle-label]');
  const titleRow = q('[data-pp-title-row]')!;
  const titleSpan = q('[data-pp-title]')!;
  const h1 = titleSpan.parentElement as HTMLElement; // .pp__title
  const hero = q('[data-pp-hero]')!;
  const aside = q('[data-pp-aside]')!;
  const notes = q('[data-pp-notes]')!;

  if (!frame || !toggle || !titleRow || !hero || !aside) return;

  let expanded = false;

  /* --------------------------------------------------- fixed-chrome geometry */
  // Align the fixed toggle/panel/footer to the capped, centred frame instead of
  // the raw viewport, and size the panel to 46% of the frame (its 46cqw).
  function geometry() {
    const r = frame.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const shellW = r.width;
    const edge = vw - r.right + shellW * 0.025; // gutter outside the frame + 2.5% inset
    root.style.setProperty('--pp-edge', `${Math.max(0, edge)}px`);
    root.style.setProperty('--pp-panel-w', `${shellW * 0.46}px`);
  }

  /* ------------------------------------------------------ measured tops (§4) */
  function track() {
    const titleTop = Math.max(92, titleRow.getBoundingClientRect().top);
    root.style.setProperty('--pp-title-top', `${titleTop}px`);
    // Closed, the panel follows the hero so it lines up with the artwork. Open,
    // it is a reading surface: pin it to the chrome band (the same 148/92 offsets
    // the stylesheet falls back to) so a long write-up gets the full height
    // instead of the ~380px gap the hero happens to leave at the top of the page.
    // Without this the panel is far shorter than its content and cannot hand the
    // wheel off either, because it carries overscroll-behavior: contain.
    const asideTop = expanded ? 148 : Math.max(148, hero.getBoundingClientRect().top);
    root.style.setProperty('--pp-aside-top', `${asideTop}px`);
    root.style.setProperty('--pp-aside-maxh', `${Math.max(0, innerHeight - asideTop - 92)}px`);
  }

  /* --------------------------------------------------- headline auto-fit (§4.2) */
  // The artist name must never wrap or overflow its column (which is
  // calc(49cqw - 24px) when expanded). Shrink the font past the clamp if needed,
  // release back to the clamp when it fits.
  // Intrinsic text width per px of font-size — constant for a given name + font
  // (letter-spacing is set in em, so the width scales linearly with size). We
  // measure it once the webfont is in, then the fit is a pure calc.
  let ratio = 0;
  function measureRatio() {
    // Width scales linearly with font-size, so we can read the ratio from the
    // CURRENT rendered size — no reset, no transition fiddling, no flicker.
    // scrollWidth reports the full text width even when it overflows max-width.
    const size = parseFloat(getComputedStyle(h1).fontSize);
    const natural = titleSpan.scrollWidth;
    if (size > 0 && natural > 0) ratio = natural / size;
  }

  // Size the name to its column for the CURRENT state — never wrap, never
  // overflow. Deterministic from the frame width + the intrinsic ratio, so the
  // follow loop sets the SAME target every frame and never restarts the CSS
  // font-size transition (which is what lets the name scale smoothly on reflow).
  function fit() {
    if (!ratio) return; // pre-webfont: leave the CSS clamp in charge
    const frameW = frame.getBoundingClientRect().width;
    const mobile = matchMedia('(max-width: 720px)').matches;
    // Size ceiling matches the CSS clamp for the breakpoint: 9.4cqw/148 desktop,
    // 15vw/88 mobile.
    const base = mobile
      ? Math.min(88, Math.max(40, 0.15 * frameW))
      : Math.min(148, Math.max(46, 0.094 * frameW));
    // Fit to the ACTUAL container: the title row's own width (95% desktop, 90%
    // mobile), or the compressed column's max-width when the write-up is open.
    // floor so the fitted name never overshoots its column.
    // On mobile the write-up is a screen-slide, not a compress, so the title
    // never narrows — always fit to the row (no scaling as screens slide).
    const avail = !mobile && expanded ? 0.49 * frameW - 24 : titleRow.clientWidth;

    // One line is the preference, not the rule. Shrinking had no floor, so a
    // long name on a narrow column kept getting smaller until it was set at
    // half the size of the tour line beside it — "Encanto At The Hollywood
    // Bowl" at a half-width window is the case that showed it. Past the floor
    // the name breaks to two lines instead, where it can be read.
    //
    // FLOOR is a fraction of the size this breakpoint would otherwise give the
    // name, not an absolute px: the whole title scale is container-relative, so
    // an absolute floor would mean something different at every width.
    const FLOOR = 0.62;
    // Two lines carry the same run of text, so each holds about half of it —
    // but only about: the break lands on a word, not at the midpoint. The
    // margin keeps the longer of the two lines inside the column.
    const BALANCE = 0.92;
    const oneLine = avail / ratio;
    const twoLines = oneLine * 2 * BALANCE;
    const lines = oneLine < base * FLOOR ? 2 : 1;
    const target = Math.floor(Math.min(base, lines === 2 ? twoLines : oneLine));

    const px = `${target}px`;
    if (h1.style.fontSize !== px) h1.style.fontSize = px;

    // The row's CSS height is one line at the breakpoint's clamp, deliberately
    // independent of the fitted size so the page does not shift as the name
    // scales. Wrapping is the one case that has to override it — and it takes
    // the height the text ACTUALLY came out at rather than assuming two lines,
    // because where the break lands is the browser's call, not ours.
    const wantLines = String(lines);
    if (titleRow.dataset.ppLines !== wantLines) titleRow.dataset.ppLines = wantLines;
    const h = lines === 2 ? `${Math.ceil(titleSpan.getBoundingClientRect().height)}px` : '';
    if (titleRow.style.height !== h) titleRow.style.height = h;
  }

  /* ----------------------------------------------------- the 900ms follow loop */
  // The reflow is 620ms + up to 275ms stagger, so one measurement at toggle time
  // is wrong. Re-measure across the whole cascade.
  let rafId = 0;
  function burst() {
    const end = performance.now() + 900;
    const step = (now: number) => {
      track();
      fit();
      if (now < end) rafId = requestAnimationFrame(step);
    };
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(step);
  }

  /* ------------------------------------------- word-split + reveal (spec §5) */
  function splitNotes() {
    if (notes.dataset.split) return;
    notes.dataset.split = '1';
    const walker = document.createTreeWalker(notes, NodeFilter.SHOW_TEXT);
    const texts: Text[] = [];
    let node: Node | null;
    while ((node = walker.nextNode())) texts.push(node as Text);

    texts.forEach((tn) => {
      const parts = (tn.textContent || '').split(/(\s+)/);
      const frag = document.createDocumentFragment();
      parts.forEach((part) => {
        if (!part) return;
        if (/^\s+$/.test(part)) {
          frag.appendChild(document.createTextNode(part));
          return;
        }
        const mask = document.createElement('span');
        mask.style.cssText = 'display:inline-block;overflow:hidden;vertical-align:bottom';
        const inner = document.createElement('span');
        inner.setAttribute('data-w', '1');
        inner.style.cssText = 'display:inline-block;transform:translateY(110%)';
        inner.textContent = part;
        mask.appendChild(inner);
        frag.appendChild(mask);
      });
      tn.replaceWith(frag);
    });
  }

  function playNotes(show: boolean) {
    const words = Array.from(notes.querySelectorAll<HTMLElement>('[data-w]'));
    const n = words.length || 1;
    const total = 400; // whole spread across all words (spec §5.2)
    const stagger = show ? Math.max(2, Math.round(total / n)) : 3;
    words.forEach((el, i) => {
      const order = show ? i : n - 1 - i; // reveal top→bottom, hide bottom→top
      const from = show ? 'translateY(110%)' : 'translateY(0%)';
      const to = show ? 'translateY(0%)' : 'translateY(110%)';
      el.getAnimations().forEach((a) => a.cancel()); // hard-cancel; rapid toggling must not queue
      el.style.transform = from;
      el.animate(
        [
          { transform: from, offset: 0, easing: EASE_REVEAL },
          { transform: to, offset: 1 },
        ],
        {
          duration: show ? Math.round(total * 0.69) : 300,
          delay: (show ? 120 : 0) + order * stagger,
          fill: 'both',
        },
      );
    });
  }

  /* --------------------------------------------- the toggle (spec §2.4 order) */
  function setExpanded(next: boolean) {
    expanded = next;
    root.dataset.expanded = String(expanded);
    fit(); // set the new size target NOW so it transitions in step with the reflow
    track(); // re-pin the panel band for the new state (see track())
    root.style.setProperty('--panel-delay', expanded ? '180ms' : '0ms');
    toggle.setAttribute('aria-expanded', String(expanded));
    aside.setAttribute('aria-hidden', String(!expanded));
    if (toggleLabel) toggleLabel.textContent = expanded ? 'CLOSE' : 'FULL WRITE-UP';
    if (!reduced()) {
      splitNotes();
      playNotes(expanded);
    }
    // Mobile: the write-up is a full-screen overlay, so lock the page behind it.
    document.body.style.overflow =
      expanded && matchMedia('(max-width: 720px)').matches ? 'hidden' : '';
    burst();
  }
  toggle.addEventListener('click', () => setExpanded(!expanded));

  // Mobile swipe cues also tap-toggle: the "open" cue → write-up, "close" → back.
  root.querySelectorAll<HTMLElement>('[data-pp-cue]').forEach((c) =>
    c.addEventListener('click', () => setExpanded(c.dataset.ppCue === 'open')),
  );

  /* ----------------------------------------- mobile: swipe to the write-up */
  // Swipe left opens it, swipe right closes it — a horizontal-dominant drag past
  // a threshold, so vertical scrolling of the panel is unaffected.
  let sx = 0,
    sy = 0,
    tracking = false;
  root.addEventListener(
    'touchstart',
    (e) => {
      if (e.touches.length !== 1 || !matchMedia('(max-width: 720px)').matches) return;
      sx = e.touches[0].clientX;
      sy = e.touches[0].clientY;
      tracking = true;
    },
    { passive: true },
  );
  root.addEventListener(
    'touchend',
    (e) => {
      if (!tracking) return;
      tracking = false;
      const dx = e.changedTouches[0].clientX - sx;
      const dy = e.changedTouches[0].clientY - sy;
      if (Math.abs(dx) < 55 || Math.abs(dx) < Math.abs(dy) * 1.4) return; // not horizontal
      if (dx < 0 && !expanded) setExpanded(true);
      else if (dx > 0 && expanded) setExpanded(false);
    },
    { passive: true },
  );

  /* --------------------------------------------------------- scroll / resize */
  const onScroll = () => track();
  const onResize = () => {
    geometry();
    track();
    fit();
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onResize);

  // Tear down on soft-nav so nothing ticks against a detached DOM.
  document.addEventListener(
    'astro:before-swap',
    () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
      document.body.style.overflow = ''; // release the mobile write-up scroll lock
    },
    { once: true },
  );

  /* ------------------------------------------------------------- kick off */
  geometry();
  measureRatio();
  track();
  fit();
  burst(); // settle across the arrival (flight morph) and first layout
  // Re-measure + re-fit once webfonts land — metrics differ from the fallback.
  document.fonts?.ready?.then(() => {
    measureRatio();
    geometry();
    fit();
    track();
  });
}
