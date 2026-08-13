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
  const gallery = (doc.gallery ?? [])
    .map((g: any) => mediaUrl(g?.image))
    .filter((url: string) => url !== '');

  const writeup = {
    lead: doc.writeup?.lead ?? '',
    body: (doc.writeup?.body ?? []).map((p: any) => p?.paragraph ?? ''),
  };

  return {
    slug: doc.slug,
    title: doc.title,
    code: doc.code,
    client: doc.client,
    year: doc.year,
    role: doc.role,
    scope: doc.scope,
    thumb: mediaUrl(doc.thumb),
    hero: mediaUrl(doc.hero),
    body: doc.body,
    order: doc.order,
    capabilities: doc.capabilities ?? [],
    tour: doc.tour ?? '',
    collaborator: doc.collaborator ?? '',
    summary: doc.summary ?? '',
    gallery,
    stats: doc.stats ?? [],
    credits: doc.credits ?? [],
    writeup,
  };
}

/** Fetch all projects, ordered by `order`. */
export async function getProjects(): Promise<Project[]> {
  const res = await fetch(`${API_URL}/api/projects?limit=100&depth=2&sort=order`);
  if (!res.ok) throw new Error(`Payload API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.docs.map(mapPayloadProject);
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
