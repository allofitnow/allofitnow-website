// Work <-> Project flight, on Astro's ClientRouter + the native View Transitions
// API. A single shared view-transition-name ("aoin-flight") is applied at runtime
// to the one element that should morph — the clicked grid tile's image on the way
// in, and the matching grid tile on the way back — so the browser tweens it from
// the tile crop to the project hero and back. Everything else cross-fades as the
// root (see styles/transitions.css). The original hand-tuned engine lives in
// docs/prototypes/reflow-transition.html; this is its Astro-native port.
//
// Naming exactly one element per document is the whole trick: two elements
// sharing a view-transition-name aborts the group, so the source is tagged just
// before the OLD snapshot (on click) and the target just before the NEW snapshot
// (astro:before-swap), then every dynamic name is cleared once the swap lands.

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

// OUTGOING source — tag the element that is leaving, before ClientRouter starts
// the transition and captures the old snapshot.
document.addEventListener(
  'click',
  (e) => {
    const a = (e.target as Element)?.closest?.('a[href]') as HTMLAnchorElement | null;
    if (!a) return;
    let toPath = '';
    try {
      toPath = new URL(a.href, location.origin).pathname;
    } catch {
      return;
    }
    if (isProjectPath(toPath)) {
      // work grid -> project: the clicked tile's image is the morph source.
      tag(a.closest('a[data-slug]')?.querySelector('img'));
    } else if (isWorkPath(toPath)) {
      // project -> work: the current hero morphs back into its grid tile.
      tag(document.querySelector('.hero[data-slug] img'));
    }
  },
  true,
);

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
