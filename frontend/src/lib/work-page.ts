/* AOIN — Work page behaviour. Ported from the design handoff (work-page.ts);
 * every timing constant is documented in the handoff ANIMATION_SPEC.md.
 *
 * Adapted for our app: the shared Nav (persisted, in Base) owns the clock and
 * its own reveal, so it's NOT in the intro chrome array here, and there's no
 * clock in this module. A tile click soft-navs to the project (forward flight),
 * so we tear the follow-loop down on astro:before-swap. Reaching /work itself is
 * a full load (links carry data-astro-reload), so the module re-runs fresh each
 * visit — the reason it doesn't need per-navigation re-binding.
 */

type View = 'large' | 'grid' | 'list';
const EASE_BRAND = 'cubic-bezier(.05,.89,0,.99)';
const EASE_HARD = 'cubic-bezier(.87,0,.13,1)';
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export function initWorkPage(root: HTMLElement) {
  if (!root || root.dataset.booted) return;
  root.dataset.booted = '1';

  const num = (k: string, d: number) => Number(root.dataset[k] ?? d);
  const cfg = {
    columns: num('columns', 4),
    introDuration: num('introDuration', 1400),
    introOverlap: num('introOverlap', 0.9),
    titleLead: num('titleLead', 0),
    stagger: num('stagger', 1.3),
  };

  let view: View = 'large';
  let filter = 'ALL';
  let introRan = false;
  let introSettled = false;

  const gridPane = root.querySelector<HTMLElement>('[data-pane="grid"]')!;
  const listPane = root.querySelector<HTMLElement>('[data-pane="list"]')!;
  const thumb = root.querySelector<HTMLElement>('[data-hover-thumb]')!;

  /* ----------------------------------------------------------- view/filter */
  const mqMobile = matchMedia('(max-width: 720px)');
  function apply(skipStagger = false) {
    // On phones halve the column count so the thumbnails aren't tiny: the 2-up
    // "large" view goes 1-up, and the 4-up "grid" view goes 2-up.
    const m = mqMobile.matches;
    const [cols, ar] = view === 'large' ? [m ? 1 : 2, '16/9'] : [m ? 2 : cfg.columns, '4/3'];
    root.style.setProperty('--cols', String(cols));
    root.style.setProperty('--tile-ar', ar);

    gridPane.style.display = view === 'list' ? 'none' : 'grid';
    listPane.style.display = view === 'list' ? 'flex' : 'none';
    if (view !== 'list') hideThumb();

    root.querySelectorAll<HTMLElement>('[data-view]').forEach((b) => {
      b.setAttribute('aria-pressed', String(b.dataset.view === view));
    });
    root.querySelectorAll<HTMLElement>('.filt').forEach((b) => {
      b.setAttribute('aria-pressed', String(b.dataset.cap === filter));
    });

    const on = (el: HTMLElement) => filter === 'ALL' || (el.dataset.cap ?? '').split('|').includes(filter);
    root.querySelectorAll<HTMLElement>('.tile').forEach((t) => {
      t.style.display = on(t) ? 'block' : 'none';
    });
    root.querySelectorAll<HTMLElement>('.row').forEach((r) => {
      r.style.display = on(r) ? 'grid' : 'none';
    });

    if (!skipStagger) {
      // A real view/filter change clears any return-morph reorder (the CSS
      // `order` the flight set) so the grid returns to source order.
      root.querySelectorAll<HTMLElement>('.tile').forEach((t) => (t.style.order = ''));
      stagger();
    }
  }

  root.querySelectorAll<HTMLElement>('[data-view]').forEach((b) =>
    b.addEventListener('click', () => {
      view = b.dataset.view as View;
      apply();
    }),
  );
  root.querySelectorAll<HTMLElement>('.filt').forEach((b) =>
    b.addEventListener('click', () => {
      filter = b.dataset.cap!;
      apply();
    }),
  );

  /* -------------------------------------------------------------- stagger */
  // Y offset + delay randomised per item so the reveal reads scattered, not
  // swept. Opacity is a HARD CUT (0s, delayed) — only position eases.
  let lastKey = '';
  function stagger() {
    const key = view + '|' + filter;
    if (key === lastKey) return;
    lastKey = key;

    const items = Array.from(
      root.querySelectorAll<HTMLElement>(view === 'list' ? '.row' : '.grid-pane .tile'),
    ).filter((n) => n.style.display !== 'none');

    if (reduced()) {
      items.forEach((n) => {
        n.style.transition = 'none';
        n.style.opacity = '1';
        n.style.transform = 'none';
      });
      return;
    }

    const base = introSettled ? 0 : cfg.introDuration * (cfg.titleLead + 0.08);
    items.forEach((n, i) => {
      n.style.transition = 'none';
      n.style.opacity = '0';
      n.style.transform = `translateY(${10 + Math.random() * 26}px)`;
      void n.offsetHeight; // force reflow, else no transition
      const d = base + (i * 28 + Math.random() * 260) * cfg.stagger;
      n.style.transition = `transform .55s ${EASE_BRAND} ${d}ms, opacity 0s linear ${d}ms`;
      n.style.opacity = '1';
      n.style.transform = 'translateY(0)';
    });
  }

  /* ---------------------------------------------------------------- intro */
  function intro() {
    if (introRan) return;
    introRan = true;
    if (reduced()) {
      // No motion, but still REVEAL the headline — the words default to
      // translateY(110%) (hidden below the mask) and rely on this to show.
      root.querySelectorAll<HTMLElement>('[data-word]').forEach((w) => {
        w.style.transition = 'none';
        w.style.transform = 'translate(0,0)';
      });
      return;
    }

    const words = Array.from(root.querySelectorAll<HTMLElement>('[data-word]'));
    if (words.length === 2) {
      const [a, b] = words;
      const box = (a.parentElement!.parentElement as HTMLElement).getBoundingClientRect();
      const ar = a.getBoundingClientRect();
      const br = b.getBoundingClientRect();
      const centre = box.left + box.width / 2;
      const dxA = centre - ar.width - box.width * 0.012 - ar.left;
      const dxB = centre + box.width * 0.012 - br.left;

      const D = cfg.introDuration;
      a.style.transform = `translate(${dxA}px,110%)`;
      b.style.transform = `translate(${dxB}px,110%)`;
      void a.offsetHeight;
      a.style.transition = `transform ${D}ms ${EASE_BRAND}`;
      b.style.transition = `transform ${D}ms ${EASE_BRAND}`;

      requestAnimationFrame(() => {
        a.style.transform = `translate(${dxA}px,0)`; // 1. rise, still centred
        b.style.transform = `translate(${dxB}px,0)`;
        setTimeout(() => {
          // 2. spread to the page edges, overlapping the rise
          a.style.transition = `transform ${D * 1.2}ms ${EASE_BRAND}`;
          b.style.transition = `transform ${D * 1.2}ms ${EASE_BRAND}`;
          a.style.transform = 'translate(0,0)';
          b.style.transform = 'translate(0,0)';
        }, D * (1 - cfg.introOverlap));
      });
    }

    // filter-bar children → footer, randomised (nav is the shared persisted
    // component and reveals itself, so it's not in this list).
    const chrome = [
      ...Array.from(root.querySelectorAll<HTMLElement>('[data-filterbar] > *')),
      root.querySelector<HTMLElement>('[data-foot]'),
    ].filter(Boolean) as HTMLElement[];

    chrome.forEach((n, i) => {
      n.style.transition = 'none';
      n.style.opacity = '0';
      n.style.transform = `translateY(${8 + Math.random() * 22}px)`;
      void n.offsetHeight;
      const d = cfg.introDuration * cfg.titleLead + (i * 40 + Math.random() * 220) * cfg.stagger;
      n.style.transition = `transform .8s ${EASE_BRAND} ${d}ms, opacity .01s linear ${d}ms`;
      n.style.opacity = '1';
      n.style.transform = 'translateY(0)';
    });
  }

  /* -------------------------------------------------- list hover reveal */
  let tx = 0,
    ty = 0,
    cx: number | null = null,
    cy: number | null = null;
  let lastRow: HTMLElement | null = null;
  let raf = 0;

  // The thumbnail's X is LOCKED — it only tracks the cursor vertically. The row
  // is year | name(30%) | tour(14%) | chips(1fr), so year+name+tour never pass
  // ~62% of the row; park the thumbnail just right of that so it never covers
  // the artist or tour names, clamped to stay inside the row.
  function lockedX() {
    const r = listPane.getBoundingClientRect();
    const half = thumb.offsetWidth / 2;
    const x = r.left + r.width * 0.62 + half + 12;
    return Math.min(r.right - half, Math.max(r.left + half, x));
  }

  function follow() {
    if (cx === null || cy === null) {
      raf = requestAnimationFrame(follow);
      return;
    }
    cx += (tx - cx) * 0.12; // follow damping, lower is laggier
    cy += (ty - cy) * 0.12;
    thumb.style.transform = `translate(${cx - thumb.offsetWidth / 2}px,${cy - thumb.offsetHeight / 2}px)`;
    raf = requestAnimationFrame(follow);
  }
  raf = requestAnimationFrame(follow);

  function hideThumb() {
    thumb.style.visibility = 'hidden';
    thumb.replaceChildren();
  }

  function pushMedia(src: string) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:absolute;inset:0;overflow:hidden;transform:translateY(-100%)';
    const img = document.createElement('img');
    img.src = src;
    img.style.cssText =
      'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block;transform:translateY(90%)';
    wrap.appendChild(img);
    thumb.appendChild(wrap);
    void wrap.offsetHeight; // reflow, or the wipe never runs
    // Counter-move: the mask drops in from -100% while the image rises from
    // +90% inside it, so the picture appears uncovered rather than slid.
    wrap.style.transition = `transform .6s ${EASE_HARD}`;
    img.style.transition = `transform .6s ${EASE_HARD}`;
    wrap.style.transform = 'translateY(0)';
    img.style.transform = 'translateY(0)';
    while (thumb.children.length > 8) thumb.firstChild!.remove();
  }

  root.addEventListener('mousemove', (e) => {
    tx = lockedX(); // X is pinned; only Y follows the cursor
    ty = e.clientY;
    if (cx === null) {
      cx = tx;
      cy = e.clientY;
    }
  });
  root.addEventListener('mouseover', (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>('.row');
    if (!row || row === lastRow) return;
    lastRow = row;
    thumb.style.visibility = 'visible';
    pushMedia(row.dataset.thumb!);
    root.querySelectorAll<HTMLElement>('.row').forEach((r) => {
      r.style.opacity = r === row ? '1' : '0.35';
    });
  });
  root.addEventListener('mouseout', (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>('.row');
    if (!row) return;
    if ((e.relatedTarget as HTMLElement | null)?.closest?.('.row')) return;
    lastRow = null;
    hideThumb();
    root.querySelectorAll<HTMLElement>('.row').forEach((r) => {
      r.style.opacity = '1';
    });
  });

  // Re-apply the column count when crossing the mobile breakpoint (e.g. rotate),
  // without re-running the reveal stagger.
  const onBreakpoint = () => apply(true);
  mqMobile.addEventListener('change', onBreakpoint);

  // The follow loop is the one thing that outlives the DOM on a soft-nav to a
  // project — stop it so it doesn't tick on a detached thumbnail.
  document.addEventListener(
    'astro:before-swap',
    () => {
      cancelAnimationFrame(raf);
      mqMobile.removeEventListener('change', onBreakpoint);
    },
    { once: true },
  );

  /* ------------------------------------------------------------- kick off */
  // Arrived via the return flight? The flight owns the view (2-up), the tile
  // reorder to slot 2, and the reveal (its sweep animates the other tiles +
  // chrome in while the flyer morphs into the landing tile). So skip our intro +
  // stagger — running them would re-hide the tiles the flyer is landing on.
  const returning = !!(window as any).__aoinReturnSlug;
  (window as any).__aoinReturnSlug = null; // consume it
  if (returning) {
    view = 'large';
    introSettled = true;
    // Reveal the headline statically — the words default to translateY(110%) and
    // rely on the (now-skipped) intro to show; the flight sweep rises the .display
    // wrapper, but the words inside would stay masked without this.
    root.querySelectorAll<HTMLElement>('[data-word]').forEach((w) => {
      w.style.transition = 'none';
      w.style.transform = 'translate(0,0)';
    });
    apply(true); // set view/display/filter; no stagger
  } else {
    apply();
    requestAnimationFrame(() => {
      intro();
      setTimeout(() => {
        introSettled = true;
      }, 2600);
    });
  }
}
