// #103 — wires rung-bearing videos on generic pages. Media.astro galleries,
// richtext inline write-ups, and the hero fallback path render <video> elements
// with NO src and data-rungs/data-master-src; this module parses the ladder and
// sets the chosen rung (lib/ladder.ts pickRung) so only the chosen rendition
// hits the wire. Videos owned by the /services scroll engine carry
// data-lazymedia and are SKIPPED here — services-effects.js picks their rung at
// section entry (loadMedia) so the deferral contract (nothing loads until its
// section is reached) is preserved.
import { parseRungs, pickRung } from './ladder';

function wireVideo(v: HTMLVideoElement): void {
  if (v.dataset.rungApplied === 'true') return;
  const rungs = parseRungs(v.getAttribute('data-rungs'));
  const master = v.getAttribute('data-master-src') || '';
  if (rungs.length === 0) {
    // Ladder-less upload (mov, legacy markup): degrade to single-source — set
    // the master once so the element behaves exactly like today's plain src.
    if (master && !v.getAttribute('src')) {
      v.dataset.rungApplied = 'true';
      v.src = master;
      try { v.load(); } catch { /* parse-time guard */ }
    }
    return;
  }
  v.dataset.rungApplied = 'true';
  const chosen = pickRung(rungs, master);
  if (chosen && v.getAttribute('src') !== chosen) {
    v.src = chosen;
    v.setAttribute('src', chosen);
    try { v.load(); } catch { /* parse-time guard */ }
  }
}

function wireAll(): void {
  document.querySelectorAll<HTMLVideoElement>('video[data-rungs]').forEach((v) => {
    // The scroll engine on /services loads lazymedia elements itself.
    if (v.hasAttribute('data-lazymedia')) return;
    // The homepage hero's controller (wireReel) owns its picker — same tiers,
    // but single ownership avoids double .load() races.
    if (v.getAttribute('data-ref') === 'reelVideo') return;
    wireVideo(v);
  });
}

// Late-DOM resilience (proven pattern from the #94 rebind ladder): fire at
// ready, then retry after 50/400/1500ms; re-run under the ClientRouter on
// astro:page-load (it also fires on first load — wireAll is idempotent).
wireAll();
for (const t of [50, 400, 1500]) setTimeout(wireAll, t);
document.addEventListener('astro:page-load', wireAll);
document.addEventListener('DOMContentLoaded', wireAll);
