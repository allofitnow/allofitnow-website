// Work / project content — hardcoded now, Payload-shaped for phase 2.
//
// Shape mirrors the planned `projects` collection. `code` is NOT authored: it is
// derived from the title the same way the Payload `assignCodes` beforeChange hook
// will (initials of non-stopword words, zero-padded collision counter) so the two
// never drift. `thumb` and `hero` are separate fields per the CMS model, but they
// are seeded to the SAME asset on purpose — the flight morphs the tile image into
// the hero image, so a differing crop would jump mid-transition. Swap in a real
// wider hero later and the flight still works, it just re-crops on landing.

// The Work page's four capability filters — also the shared service taxonomy
// used for the tile-overlay tags and list chips (we picked ONE wording, the
// brand's own service names, resolving the handoff's open taxonomy question).
export type Capability =
  | 'REAL-TIME CONTENT'
  | 'SCREENS PRODUCTION'
  | 'MIXED REALITY'
  | 'EQUIPMENT RENTAL';

export const CAPABILITIES: Capability[] = [
  'REAL-TIME CONTENT',
  'SCREENS PRODUCTION',
  'MIXED REALITY',
  'EQUIPMENT RENTAL',
];

export interface Project {
  slug: string;
  title: string;
  /** Derived — see assignCodes below. Do not author. */
  code: string;
  client: string;
  year: string;
  role: string;
  scope: string;
  thumb: string;
  hero: string;
  body: string;
  order: number;
  // --- Work-page fields (PLACEHOLDER copy, replace via CMS) -----------------
  /** Drives the filters + overlay tags + list chips. 2 per project today. */
  capabilities: Capability[];
  /** Overlay + list secondary line, ALL CAPS, e.g. "WORLD TOUR". Placeholder. */
  tour: string;
  /** Overlay bottom line, e.g. "ALL OF IT NOW X PHNTM". Placeholder. */
  collaborator: string;
}

// PLACEHOLDER seed copy — titles are AOIN's real clients (see the roster in
// data/home.ts); the CLIENT/YEAR/ROLE/SCOPE meta and body are stand-ins to be
// replaced per-project via the CMS. Reusing the stills we already have as art.
// capabilities/tour/collaborator are Work-page placeholders (capability[0] is
// each project's real role; the rest is invented for the filter/overlay demo).
const BODY =
  'Real-time content built for LED and driven live at show resolution. Generative systems, camera-aware grading, and a playback architecture that survives contact with a touring schedule.';

const seed: Omit<Project, 'code'>[] = [
  {
    slug: 'bad-bunny',
    title: 'BAD BUNNY',
    client: 'LIVE NATION',
    year: '2024',
    role: 'REAL-TIME CONTENT',
    scope: 'LED / PLAYBACK',
    thumb: '/assets/bad-bunny.webp',
    hero: '/assets/bad-bunny.webp',
    body: BODY,
    order: 1,
    capabilities: ['REAL-TIME CONTENT', 'SCREENS PRODUCTION'],
    tour: 'WORLD TOUR',
    collaborator: 'ALL OF IT NOW X PHNTM',
  },
  {
    slug: 'rauw-alejandro',
    title: 'RAUW ALEJANDRO',
    client: 'SONY MUSIC',
    year: '2024',
    role: 'SCREENS PRODUCTION',
    scope: 'LED / XR',
    thumb: '/assets/rauw-alejandro.webp',
    hero: '/assets/rauw-alejandro.webp',
    body: BODY,
    order: 2,
    capabilities: ['SCREENS PRODUCTION', 'MIXED REALITY'],
    tour: 'SATURNO TOUR',
    collaborator: 'ALL OF IT NOW X STURDY.CO',
  },
  {
    slug: 'martin-garrix',
    title: 'MARTIN GARRIX',
    client: 'STMPD RCRDS',
    year: '2023',
    role: 'REAL-TIME CONTENT',
    scope: 'LED / PLAYBACK',
    thumb: '/assets/martin-garrix.webp',
    hero: '/assets/martin-garrix.webp',
    body: BODY,
    order: 3,
    capabilities: ['REAL-TIME CONTENT', 'MIXED REALITY'],
    tour: 'FESTIVAL RUN',
    collaborator: 'ALL OF IT NOW X STURDY.CO',
  },
  {
    slug: 'peso-pluma',
    title: 'PESO PLUMA',
    client: 'DOBLE P RECORDS',
    year: '2024',
    role: 'SCREENS PRODUCTION',
    scope: 'LED / PLAYBACK',
    thumb: '/assets/peso-pluma.webp',
    hero: '/assets/peso-pluma.webp',
    body: BODY,
    order: 4,
    capabilities: ['SCREENS PRODUCTION', 'EQUIPMENT RENTAL'],
    tour: 'ARENA TOUR',
    collaborator: 'ALL OF IT NOW X STURDY.CO',
  },
  {
    slug: 'melanie-martinez',
    title: 'MELANIE MARTINEZ',
    client: 'ATLANTIC RECORDS',
    year: '2023',
    role: 'MIXED REALITY',
    scope: 'XR / COMPOSITING',
    thumb: '/assets/melanie-martinez.webp',
    hero: '/assets/melanie-martinez.webp',
    body: BODY,
    order: 5,
    capabilities: ['MIXED REALITY', 'REAL-TIME CONTENT'],
    tour: 'TRILOGY TOUR',
    collaborator: 'ALL OF IT NOW X PHNTM',
  },
  {
    slug: 'good-charlotte',
    title: 'GOOD CHARLOTTE',
    client: 'BMG',
    year: '2022',
    role: 'REAL-TIME CONTENT',
    scope: 'LED / PLAYBACK',
    thumb: '/assets/good-charlote.webp',
    hero: '/assets/good-charlote.webp',
    body: BODY,
    order: 6,
    capabilities: ['REAL-TIME CONTENT', 'EQUIPMENT RENTAL'],
    tour: 'GENERATION RX',
    collaborator: 'ALL OF IT NOW X PHNTM',
  },
  {
    slug: 'renee-rapp',
    title: 'RENÉE RAPP',
    client: 'INTERSCOPE',
    year: '2024',
    role: 'REAL-TIME CONTENT',
    scope: 'LED / XR',
    thumb: '/assets/renee-rapp.webp',
    hero: '/assets/renee-rapp.webp',
    body: BODY,
    order: 7,
    capabilities: ['REAL-TIME CONTENT', 'SCREENS PRODUCTION'],
    tour: 'THEATRE TOUR',
    collaborator: 'ALL OF IT NOW X PHNTM',
  },
];

// Ported verbatim from the reflow prototype (and the planned Payload hook):
// initials of each non-stopword word, capped at 3, with a zero-padded per-code
// collision counter. Non-A–Z characters are stripped first (so RENÉE → RENE → R).
const STOPWORDS = new Set(['THE', 'A', 'AN', 'OF', 'AND']);
function assignCodes(list: Omit<Project, 'code'>[]): Project[] {
  const seen: Record<string, number> = {};
  return list.map((p) => {
    const ini =
      p.title
        .toUpperCase()
        .replace(/[^A-Z ]/g, '')
        .split(/\s+/)
        .filter((w) => w && !STOPWORDS.has(w))
        .map((w) => w[0])
        .join('')
        .slice(0, 3) || 'XX';
    seen[ini] = (seen[ini] || 0) + 1;
    return { ...p, code: ini + String(seen[ini]).padStart(2, '0') };
  });
}

export const projects: Project[] = assignCodes(seed).sort((a, b) => a.order - b.order);

export const getProject = (slug: string): Project | undefined =>
  projects.find((p) => p.slug === slug);
