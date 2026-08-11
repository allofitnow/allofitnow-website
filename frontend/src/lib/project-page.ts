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
  const toggle = q('[data-pp-toggle]')!;
  const toggleLabel = q('[data-pp-toggle-label]')!;
  const titleRow = q('[data-pp-title-row]')!;
  const titleSpan = q('[data-pp-title]')!;
  const h1 = titleSpan.parentElement as HTMLElement; // .pp__title
  const hero = q('[data-pp-hero]')!;
  const aside = q('[data-pp-aside]')!;
  const notes = q('[data-pp-notes]')!;
  const nextLink = q('[data-pp-next-link]')!;
  const nextLines = Array.from(root.querySelectorAll<HTMLElement>('[data-pp-next-line]'));

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
    const asideTop = Math.max(148, hero.getBoundingClientRect().top);
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
    const base = Math.min(148, Math.max(46, 0.094 * frameW)); // clamp(46, 9.4cqw, 148)
    // Expanded column is calc(49cqw - 24px); collapsed the name has the row.
    const avail = expanded ? 0.49 * frameW - 24 : 0.95 * frameW;
    const target = Math.round(Math.min(base, avail / ratio));
    const px = `${target}px`;
    if (h1.style.fontSize !== px) h1.style.fontSize = px;
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
    root.style.setProperty('--panel-delay', expanded ? '180ms' : '0ms');
    toggle.setAttribute('aria-expanded', String(expanded));
    aside.setAttribute('aria-hidden', String(!expanded));
    toggleLabel.textContent = expanded ? 'CLOSE' : 'FULL WRITE-UP';
    if (!reduced()) {
      splitNotes();
      playNotes(expanded);
    }
    burst();
  }
  toggle.addEventListener('click', () => setExpanded(!expanded));

  /* -------------------------------------------- next-project plate (spec §6) */
  let closeTimer = 0;
  function plate(open: boolean) {
    if (open) {
      clearTimeout(closeTimer);
      nextLink.dataset.open = 'true';
      nextLines.forEach((el, i) => {
        el.getAnimations().forEach((a) => a.cancel());
        el.animate(
          [
            { transform: 'translateY(110%)', letterSpacing: '-0.02em' },
            { transform: 'translateY(0%)', letterSpacing: '0.08em' },
          ],
          { duration: 420, delay: 140 + i * 90, easing: EASE_REVEAL, fill: 'both' },
        );
      });
    } else {
      // 60ms hold prevents flicker when the pointer crosses the plate seam.
      closeTimer = window.setTimeout(() => {
        nextLink.dataset.open = 'false';
        nextLines.forEach((el, i) => {
          el.getAnimations().forEach((a) => a.cancel());
          el.animate(
            [
              { transform: 'translateY(0%)', letterSpacing: '0.08em' },
              { transform: 'translateY(110%)', letterSpacing: '-0.02em' },
            ],
            { duration: 500, delay: (1 - i) * Math.round(500 / 6), easing: EASE_REVEAL, fill: 'both' },
          );
        });
      }, 60);
    }
  }
  if (nextLink && !reduced()) {
    nextLink.addEventListener('mouseenter', () => plate(true));
    nextLink.addEventListener('mouseleave', () => plate(false));
    nextLink.addEventListener('focus', () => plate(true));
    nextLink.addEventListener('blur', () => plate(false));
  }

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
