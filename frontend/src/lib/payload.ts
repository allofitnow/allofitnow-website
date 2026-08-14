// Payload CMS API client — build-time fetching for SSG.
// Centralizes the API base URL + the response-shape mapping from Payload's
// REST JSON into the frontend `Project` interface (see data/projects.ts).

import type { Project } from '@/data/projects';

const API_URL = import.meta.env.PAYLOAD_URL || 'http://192.168.30.245';

/** Normalize a media object (or null) into an absolute URL string. */
function mediaUrl(media: { url?: string } | null | undefined): string {
  const url = media?.url;
  if (!url) return '';
  return url.startsWith('/') ? `${API_URL}${url}` : url;
}

/** Map a Payload projects REST doc to the frontend `Project` shape. */
export function mapPayloadProject(doc: any): Project {
  const gallery = (doc.gallery ?? []).map((row: any) => ({
    layout: row?.layout ?? 'full',
    // `images` is now a hasMany upload → an array of populated media objects.
    images: (row?.images ?? [])
      .map((m: any) => mediaUrl(m))
      .filter((url: string) => url !== ''),
  }));

  const credits = (doc.credits ?? []).map((g: any) => ({
    title: g?.title ?? '',
    entries: (g?.entries ?? []).map((e: any) => ({
      title: e?.title ?? '',
      name: e?.name ?? '',
      url: e?.url ?? '',
    })),
  }));

  return {
    slug: doc.slug,
    title: doc.title,
    year: doc.year,
    image: mediaUrl(doc.image),
    order: doc.order,
    capabilities: doc.capabilities ?? [],
    services: doc.services ?? [],
    tour: doc.tour ?? '',
    collaborator: doc.collaborator ?? '',
    summary: doc.summary ?? '',
    gallery,
    stats: doc.stats ?? [],
    credits,
    // Rich text (Slate node array) passed straight through; rendered by
    // renderRichText in the project page.
    writeup: doc.writeup ?? [],
  };
}

// Build-time memoisation. SSG prerenders ~20 pages, and Base.astro + each page
// + FootBar every call getProjects — so without a cache the same roster request
// fires 40+ times in a burst and trips the API rate limit (429), failing the
// build (and the on-save auto-publish). Cache the promise so it's fetched once
// per build. In dev (per-request SSR) skip the cache so edits show on reload; on
// failure clear it so a retry can re-fetch instead of replaying the rejection.
let projectsCache: Promise<Project[]> | null = null;

/** Fetch all projects, ordered by `order`. Memoised for the production build. */
export function getProjects(): Promise<Project[]> {
  if (import.meta.env.PROD && projectsCache) return projectsCache;
  const req = (async () => {
    const res = await fetch(`${API_URL}/api/projects?limit=100&depth=2&sort=order&where[status][equals]=published`);
    if (!res.ok) throw new Error(`Payload API ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return data.docs.map(mapPayloadProject);
  })();
  if (import.meta.env.PROD) {
    projectsCache = req;
    req.catch(() => { projectsCache = null; });
  }
  return req;
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
