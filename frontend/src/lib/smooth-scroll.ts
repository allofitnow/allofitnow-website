import Lenis from 'lenis';

// Site-wide smooth scroll. A single Lenis instance lives on window.__aoinLenis and is shared by
// every page — the homepage controller (home.controller.ts) and the /services engine both read
// the same global, so this is created on demand and reused (never double-instanced). It persists
// across ClientRouter soft-navigations; Base.astro re-measures it on each page load and syncs its
// position after a swap. /services is a standalone document that manages its own Lenis on full load.
export function ensureLenis(): Lenis | null {
  if (typeof window === 'undefined') return null;
  if (window.__aoinLenis) return window.__aoinLenis;

  const lenis = new Lenis({ lerp: 0.09, wheelMultiplier: 1 });
  window.__aoinLenis = lenis;

  // Self-perpetuating rAF; the guard lets home.controller's destroy() stop it (it clears the global).
  const raf = (time: number) => {
    if (!window.__aoinLenis) return;
    window.__aoinLenis.raf(time);
    window.__aoinLenisRaf = requestAnimationFrame(raf);
  };
  window.__aoinLenisRaf = requestAnimationFrame(raf);

  return lenis;
}
