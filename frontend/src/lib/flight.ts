// Work / Home <-> Project flight, on Astro's ClientRouter + the native View
// Transitions API. A single shared view-transition-name ("aoin-flight") is
// applied at runtime to the one element that should morph — the clicked tile's
// image (work grid OR the home marquee) on the way in, and the matching grid
// tile on the way back — so the browser tweens it from the tile crop to the
// project hero and back. Everything else swaps hard (no root cross-fade); the
// copy sweeps in/out via its own named groups (see styles/transitions.css).
//
// Naming exactly one element per document is the whole trick: two elements
// sharing a name aborts the group. The source is tagged in before-preparation
// (which only fires on a REAL navigation — so a suppressed marquee drag never
// tags anything), the target in before-swap, and everything is cleared after.

const NAME = 'aoin-flight';

const isWorkPath = (p: string) => /^\/work\/?$/.test(p);
const isProjectPath = (p: string) => /^\/work\/[^/]+\/?$/.test(p);

function tag(el: Element | null | undefined) {
  if (!el) return;
  const h = el as HTMLElement;
  h.style.viewTransitionName = NAME;
  h.setAttribute('data-flight-name', '');
}

function clearNames() {
  document.querySelectorAll<HTMLElement>('[data-flight-name]').forEach((el) => {
    el.style.viewTransitionName = '';
    el.removeAttribute('data-flight-name');
  });
}

// OUTGOING source — tag the element leaving, keyed off whatever actually
// triggered the navigation. before-preparation (not click) means a suppressed
// marquee drag never tags anything, and it fires before the old snapshot.
document.addEventListener('astro:before-preparation', (e: any) => {
  const toPath: string = e.to?.pathname ?? '';
  const src: Element | undefined = e.sourceElement;
  if (isProjectPath(toPath)) {
    // work grid OR home marquee -> project: the clicked tile's image morphs.
    tag(src?.closest?.('a[data-slug]')?.querySelector('img'));
  } else if (isWorkPath(toPath)) {
    // project -> work: the current hero morphs back into its grid tile.
    tag(document.querySelector('.hero[data-slug] img'));
  }
});

// INCOMING target — tag the matching element inside the parsed destination
// document so the new snapshot carries the same name.
document.addEventListener('astro:before-swap', (e: any) => {
  const doc: Document | undefined = e.newDocument;
  if (!doc) return;
  const toPath: string = e.to?.pathname ?? location.pathname;

  if (isProjectPath(toPath)) {
    tag(doc.querySelector('.hero[data-slug] img'));
  } else if (isWorkPath(toPath)) {
    const slug = document.querySelector('.hero[data-slug]')?.getAttribute('data-slug');
    if (slug) tag(doc.querySelector(`a[data-slug="${slug}"] img`));
  }
});

// Snapshots are already captured by now, so clearing the live names cannot
// disturb the running animation — it just leaves the DOM clean for the next one.
document.addEventListener('astro:after-swap', clearNames);
