/**
 * Character scramble — the services page's own routine, extracted so the CTA,
 * the capability bar and the body copy all run on one clock.
 *
 * - Each character locks once progress passes its reveal front,
 *   front(i) = (i / len) * 0.68 + 0.32 — so the string resolves left to right
 *   with the tail still churning.
 * - Spaces are never scrambled: word rhythm stays readable throughout.
 * - The target is held on the element (__to) so an interrupted run resumes from
 *   the intended string rather than from whatever glyphs were on screen.
 */
export const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/-';
/** Mixed case for body copy, so a paragraph never reads as a caps ticker. */
export const COPY_GLYPHS =
  'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

type ScrambleEl = HTMLElement & { __to?: string; __raf?: number };

export function scramble(
  el: HTMLElement | null,
  to: string,
  opt: { dur?: number; pool?: string } = {}
): void {
  if (!el) return;
  const node = el as ScrambleEl;
  const dur = opt.dur ?? 620;
  const pool = opt.pool ?? GLYPHS;

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    node.__to = to;
    node.textContent = to;
    return;
  }

  const from = node.__to || node.textContent || '';
  node.__to = to;
  const len = Math.max(from.length, to.length);
  const t0 = performance.now();
  if (node.__raf) cancelAnimationFrame(node.__raf);

  function frame(now: number) {
    const p = Math.min(1, (now - t0) / dur);
    let out = '';
    for (let i = 0; i < len; i++) {
      const ch = to[i];
      if (ch === undefined) continue;
      if (ch === ' ') { out += ' '; continue; }
      const front = (i / len) * 0.68 + 0.32;
      out += p >= front ? ch : pool[(Math.random() * pool.length) | 0];
    }
    node.textContent = out;
    if (p < 1) node.__raf = requestAnimationFrame(frame);
    else node.textContent = to;
  }
  node.__raf = requestAnimationFrame(frame);
}
