// Payload CMS API client — build-time fetching for SSG.
// Centralizes the API base URL + the response-shape mapping from Payload's
// REST JSON into the frontend `Project` interface (see data/projects.ts).

import type { Project } from '@/data/projects';
import type { Equipment } from '@/data/equipment';
import type { ServiceSection } from '@/data/services';
import type { Reel } from '@/data/home';
import { toMediaDoc } from '@/lib/media';

const API_URL = import.meta.env.PAYLOAD_URL || 'http://192.168.30.245';

/** Normalize a media object (or null) into an absolute URL string.
 *  Exported for lib/richtext.ts, which resolves the media docs that Payload
 *  populates into inline `upload` nodes in a rich-text field. */
export function mediaUrl(media: { url?: string } | null | undefined): string {
  const url = media?.url;
  if (!url) return '';
  return url.startsWith('/') ? `${API_URL}${url}` : url;
}

/** Collaborator display: the CMS stores the PARTNER NAME only (e.g. "PHNTM"); the site always
 *  shows it as "ALL OF IT NOW X <partner>". Idempotent — strips any pre-existing prefix first, so it
 *  reads correctly whether the stored value is already migrated (partner-only) or still the old full
 *  string. Empty stays empty (solo AOIN work → no collaborator row). */
function formatCollaborator(c: unknown): string {
  const raw = typeof c === 'string' ? c.trim() : '';
  if (!raw) return '';
  const partner = raw.replace(/^ALL\s+OF\s+IT\s+NOW\s*X\s*/i, '').trim();
  return partner ? `ALL OF IT NOW X ${partner}` : raw;
}

/** Map a Payload projects REST doc to the frontend `Project` shape. */
export function mapPayloadProject(doc: any): Project {
  const gallery = (doc.gallery ?? []).map((row: any) => {
    // Each row's images are an array of { image: media }. Tolerate the older
    // hasMany-relationship shape (bare media objects) too, so a build mid-migration
    // never blanks a gallery: use `it.image` when present, else `it` itself.
    // Map once to { url, doc } pairs, drop blanks, then split — keeps the
    // images[] and docs[] arrays index-aligned by construction.
    const pairs = (row?.images ?? [])
      .map((it: any) => {
        const media = it?.image ?? it;
        return { url: mediaUrl(media), doc: it && typeof it === 'object' ? toMediaDoc(media) : null };
      })
      .filter((p: any) => p.url !== '');
    return { layout: row?.layout ?? 'full', images: pairs.map((p: any) => p.url), docs: pairs.map((p: any) => p.doc) };
  });

  const credits = (doc.credits ?? []).map((g: any) => ({
    title: g?.title ?? '',
    entries: (g?.entries ?? []).map((e: any) => ({
      title: e?.title ?? '',
      name: e?.name ?? '',
      url: e?.url ?? '',
    })),
  }));

  // A row is only worth rendering if it goes somewhere, so URL-less rows are
  // dropped here rather than rendered as dead text. The publication falls back
  // to the link's host so a row is never nameless.
  const press = (doc.press ?? [])
    .map((r: any) => {
      const url = typeof r?.url === 'string' ? r.url.trim() : '';
      if (!url) return null;
      let host = '';
      try {
        host = new URL(url).hostname.replace(/^www\./, '').toUpperCase();
      } catch {
        host = '';
      }
      return {
        publication: (r?.publication ?? '').trim() || host,
        title: r?.title ?? '',
        url,
        date: r?.date ?? '',
      };
    })
    .filter((r: any): r is NonNullable<typeof r> => r !== null);

  return {
    slug: doc.slug,
    title: doc.title,
    year: doc.year,
    image: mediaUrl(doc.image),
    // Populated doc for #58 srcset (mediaUrl string kept for seeds/flight refs).
    imageDoc: toMediaDoc(doc.image),
    order: doc.order,
    featured: !!doc.featured,
    featuredOrder: typeof doc.featuredOrder === 'number' ? doc.featuredOrder : undefined,
    capabilities: doc.capabilities ?? [],
    // `services` is a relationship to `service-categories` (populated at depth ≥ 1 → objects with
    // `label`). Pre-migration it may still be plain strings, so map both to a label string.
    services: (doc.services ?? [])
      .map((s: any) => (s && typeof s === 'object' ? s.label : s))
      .filter((x: any) => typeof x === 'string' && x !== ''),
    tour: doc.tour ?? '',
    collaborator: formatCollaborator(doc.collaborator),
    summary: doc.summary ?? '',
    gallery,
    stats: doc.stats ?? [],
    credits,
    press,
    // Rich text (Slate node array) passed straight through; rendered by
    // renderRichText in the project page.
    writeup: doc.writeup ?? [],
    // Passed through as stored. At depth 2 each media block's `media` is the
    // populated document, which is what the figure serializer needs.
    writeupBlocks: Array.isArray(doc.writeupBlocks) ? doc.writeupBlocks : [],
    // Stored as a string on the select; the page only cares about 1 vs 2.
    writeupColumns: doc.writeupColumns === '2' ? 2 : 1,
  };
}

// Build-time memoisation. SSG prerenders ~20 pages, and Base.astro + each page
// + FootBar every call getProjects — so without a cache the same roster request
// fires 40+ times in a burst and trips the API rate limit (429), failing the
// build (and the on-save auto-publish). Cache the promise so it's fetched once
// per build. In dev (per-request SSR) skip the cache so edits show on reload; on
// failure clear it so a retry can re-fetch instead of replaying the rejection.
let projectsCache: Promise<Project[]> | null = null;
let routableCache: Promise<Project[]> | null = null;

/** The running order the site follows: the manual `order` decides, lowest first, and the
 *  year only settles a tie between two projects sharing a number. */
function sortRunningOrder(projects: Project[]): Project[] {
  return projects.sort((a, b) => {
    const oa = a.order ?? 0;
    const ob = b.order ?? 0;
    if (oa !== ob) return oa - ob;                 // the manual running order decides
    const ya = parseInt(a.year, 10) || 0;          // ...and only a tie falls back
    const yb = parseInt(b.year, 10) || 0;          //    to newest year first
    return yb - ya;
  });
}

/** Shared fetch for a status set, memoised per-set for the production build. */
async function fetchProjectsByStatus(statusQuery: string): Promise<Project[]> {
  const res = await fetch(`${API_URL}/api/projects?limit=100&depth=2&sort=order&${statusQuery}`);
  if (!res.ok) throw new Error(`Payload API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return sortRunningOrder(data.docs.map(mapPayloadProject));
}

/** Fetch all published projects in the running order set on the `order` field,
 *  lowest first — that is the sequence the Work grid, the list view and the
 *  prev/next links all follow. Year is only the tiebreak between two projects
 *  that share a number, so the run can be arranged freely across years rather
 *  than being locked into year blocks. Memoised for the production build. */
export function getProjects(): Promise<Project[]> {
  if (import.meta.env.PROD && projectsCache) return projectsCache;
  const req = fetchProjectsByStatus('where[status][equals]=published');
  if (import.meta.env.PROD) {
    projectsCache = req;
    req.catch(() => { projectsCache = null; });
  }
  return req;
}

/** Every project that should GET A PAGE BUILT: the published roster plus the `unlisted`
 *  ones. Unlisted is deliberately not a visibility level on the site — it is a routing
 *  level. Nothing links to an unlisted project (the Work grid, the homepage marquee and
 *  the flight roster all read `getProjects`, which stays published-only); its URL simply
 *  exists, so the link can be handed out directly. Used by `getStaticPaths` alone.
 *
 *  `archive` is still excluded outright — that status means no page at all. */
export function getRoutableProjects(): Promise<Project[]> {
  if (import.meta.env.PROD && routableCache) return routableCache;
  const req = fetchProjectsByStatus('where[status][in]=published,unlisted');
  if (import.meta.env.PROD) {
    routableCache = req;
    req.catch(() => { routableCache = null; });
  }
  return req;
}

/** Projects for the homepage bleed marquee: the `featured` set ordered by
 *  `featuredOrder`, falling back to every project (chronological) when nothing
 *  has been featured yet — so the marquee is never empty. Reuses the memoised
 *  getProjects fetch, so it costs no extra request. */
export async function getHomeMarquee(): Promise<Project[]> {
  const all = await getProjects();
  const featured = all
    .filter((p) => p.featured)
    .sort(
      (a, b) =>
        (a.featuredOrder ?? Number.MAX_SAFE_INTEGER) - (b.featuredOrder ?? Number.MAX_SAFE_INTEGER),
    );
  return featured.length ? featured : all;
}

// ---------------------------------------------------------------------------
// Equipment fleet + /services page content.
//
// Unlike projects (CMS is the hard source of truth, build fails if unreachable), these are
// NEWER content types: their collection/global may not exist or be populated yet. So the
// fetchers return [] on any error/empty response and the data-module accessors fall back to
// (or merge over) their local seed — the build works whether or not the CMS is live.
// ---------------------------------------------------------------------------

/** Map a Payload equipment doc to the frontend `Equipment` shape. */
export function mapPayloadEquipment(doc: any): Equipment {
  return {
    slug: doc.slug,
    label: doc.label ?? '',
    image: mediaUrl(doc.image),
    imageDoc: toMediaDoc(doc.image),
    tip: doc.tip ?? '',
    order: typeof doc.order === 'number' ? doc.order : 0,
    center: !!doc.center,
    placeholder: !!doc.placeholder,
  };
}

/** Fetch the equipment fleet from the CMS, ordered. `[]` if unreachable/empty. */
export async function getEquipmentDocs(): Promise<Equipment[]> {
  try {
    const res = await fetch(`${API_URL}/api/equipment?limit=100&depth=1&sort=order`);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.docs ?? []).map(mapPayloadEquipment);
  } catch {
    return [];
  }
}

/** Map one `services` global section row to the frontend `ServiceSection` shape.
 *  Each `gallery` item resolves to { src, href }: the shown still is its own `image` if set,
 *  else the linked project's key image; `href` points at the project page when one is linked.
 *  `slot` (1-based) pins the still to a composition position (which numbered card it replaces). */
export function mapPayloadServiceSection(row: any): ServiceSection {
  const items = (row.gallery ?? []).map((it: any) => {
    const proj = it && it.project && typeof it.project === 'object' ? it.project : null;
    // The media object that supplies the still: the item's own image, else the project's key image.
    const media = it && it.image && typeof it.image === 'object' ? it.image
      : proj && proj.image && typeof proj.image === 'object' ? proj.image : null;
    const src = it && it.image ? mediaUrl(it.image) : proj ? mediaUrl(proj.image) : '';
    const doc = toMediaDoc(media); // #58 srcset source (null for seed/static stills)
    const href = proj && proj.slug ? `/work/${proj.slug}` : undefined;
    // Project data for the hovercard — mirrors the home marquee (title / tour / capabilities).
    const caps = proj && Array.isArray(proj.capabilities) ? proj.capabilities.join('|') : undefined;
    const slot = typeof it?.slot === 'number' ? it.slot : undefined;
    // Video vs image — from the media's mimeType, with a filename-extension fallback.
    const mime = media && typeof media.mimeType === 'string' ? media.mimeType : '';
    const video = /^video\//i.test(mime) || /\.(webm|mp4|m4v|mov)(\?|$)/i.test(src);
    // "Full width" toggle → render at the media's natural aspect (uncropped) instead of 16:9.
    const wide = !!(it && it.wide);
    const w = media && typeof media.width === 'number' ? media.width : 0;
    const h = media && typeof media.height === 'number' ? media.height : 0;
    const ar = wide && w > 0 && h > 0 ? `${w} / ${h}` : undefined;
    return { src, doc, href, slug: proj?.slug, title: proj?.title, tour: proj?.tour, caps, slot, video, wide, ar };
  }).filter((g: any) => g.src !== '');
  // Sub-service labels (array of { label }) — trimmed + de-blanked. Empty → the seed defaults win downstream.
  const subs = Array.isArray(row.subs)
    ? row.subs.map((s: any) => (s && typeof s.label === 'string' ? s.label.trim() : '')).filter(Boolean)
    : [];
  return { slug: row.slug, desc: row.desc ?? '', images: items, subs };
}

/** Fetch the /services page sections from the `services` global. `[]` if unreachable/empty.
 *  depth=2 so a gallery item → its project → the project's key image are all populated. */
export async function getServicesGlobal(): Promise<ServiceSection[]> {
  try {
    const res = await fetch(`${API_URL}/api/globals/services?depth=2`);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.sections ?? []).map(mapPayloadServiceSection);
  } catch {
    return [];
  }
}

/** Fetch the About page team roster from the `about` global — array order is render order.
 *  `[]` on any error/empty/404 so the frontend falls back to its local seed (never blanks the
 *  page while the global is unpopulated). depth=0: the roster is plain text, no relations. */
export async function getAboutTeam(): Promise<{ name: string; title: string }[]> {
  try {
    const res = await fetch(`${API_URL}/api/globals/about?depth=0`);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.team ?? [])
      .map((m: any) => ({
        name: typeof m?.name === 'string' ? m.name.trim() : '',
        title: typeof m?.title === 'string' ? m.title.trim() : '',
      }))
      .filter((m: { name: string }) => m.name !== '');
  } catch {
    return [];
  }
}

/** Pull a Vimeo id — and the privacy hash an unlisted video needs — out of whatever the CMS
 *  field holds. Accepts a share URL (`vimeo.com/ID`, `vimeo.com/ID/HASH`), a player URL
 *  (`player.vimeo.com/video/ID?h=HASH`), the `?h=` query form, or a bare id, so pasting
 *  the address bar just works. `id: ''` when there is no id to be found. */
export function parseVimeo(input: string): { id: string; hash: string } {
  const raw = typeof input === 'string' ? input.trim() : '';
  if (!raw) return { id: '', hash: '' };
  if (/^\d+$/.test(raw)) return { id: raw, hash: '' };
  const id = (raw.match(/(?:vimeo\.com|video)\/(\d+)/i) || [])[1] || '';
  if (!id) return { id: '', hash: '' };
  // The hash rides either as the path segment after the id, or as ?h=.
  const query = (raw.match(/[?&]h=([0-9a-z]+)/i) || [])[1];
  const segment = (raw.match(new RegExp('/' + id + '/([0-9a-z]+)', 'i')) || [])[1];
  return { id, hash: query || segment || '' };
}

/** Fetch the hero reel from the `homepage` global. `null` on any error or empty response —
 *  and equally when the chosen source has nothing behind it yet (file not uploaded, link not
 *  pasted), so data/home.ts falls back to the seed rather than opening the hero on a black
 *  box. depth=1 populates the upload relations into media docs carrying a `url`. */
export async function getHomepageReel(): Promise<Reel | null> {
  try {
    const res = await fetch(`${API_URL}/api/globals/homepage?depth=1`);
    if (!res.ok) return null;
    const data = await res.json();
    const reel = data?.reel;
    if (!reel) return null;
    if (reel.source === 'upload') {
      const src = mediaUrl(reel.video);
      if (!src) return null;
      // #99: rendition ladder from the media doc's sizes map, ascending by
      // width, master pushed as the top rung (so a ladder-less upload still
      // yields one rung = today's single-source behaviour). Rung URLs are
      // derived from the master src by filename substitution — SAME ORIGIN as
      // src by construction, so the publish translate stage rewrites them
      // exactly like it rewrites src (deriving from API_URL instead breaks:
      // build envs point PAYLOAD_URL at 127.0.0.1, which translate never
      // rewrites).
      const rungs: { w: number; url: string }[] = [];
      const sizes = reel.video && typeof reel.video === 'object' ? reel.video.sizes : null;
      const srcDir = src.slice(0, src.lastIndexOf('/') + 1);
      if (sizes && typeof sizes === 'object') {
        for (const k of Object.keys(sizes)) {
          const e = sizes[k];
          if (
            e && typeof e === 'object' &&
            typeof e.filename === 'string' && e.filename !== '' &&
            typeof e.width === 'number' && e.width > 0
          ) {
            rungs.push({ w: e.width, url: srcDir + e.filename });
          }
        }
      }
      const masterW =
        typeof reel.video?.width === 'number' && reel.video.width > 0 ? reel.video.width : 1920;
      rungs.push({ w: masterW, url: src });
      rungs.sort((a, b) => a.w - b.w);
      return { source: 'upload', src, poster: mediaUrl(reel.poster), vimeoId: '', hash: '', rungs };
    }
    const { id, hash } = parseVimeo(reel.vimeoUrl);
    return id ? { source: 'vimeo', src: '', poster: '', vimeoId: id, hash, rungs: [] } : null;
  } catch {
    return null;
  }
}

/** Fetch a single project by slug. */
export async function getProject(slug: string): Promise<Project | undefined> {
  const res = await fetch(
    `${API_URL}/api/projects?where[slug][equals]=${encodeURIComponent(slug)}&depth=2`
  );
  if (!res.ok) throw new Error(`Payload API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.docs.length > 0 ? mapPayloadProject(data.docs[0]) : undefined;
}
