// Work / project content — hardcoded now, Payload-shaped for phase 2.
//
// Shape mirrors the planned `projects` collection. `code` is NOT authored: it is
// derived from the title the same way the Payload `assignCodes` beforeChange hook
// will (initials of non-stopword words, zero-padded collision counter) so the two
// never drift. `thumb` and `hero` are separate fields per the CMS model, but they
// are seeded to the SAME asset on purpose — the flight morphs the tile image into
// the hero image, so a differing crop would jump mid-transition. Swap in a real
// wider hero later and the flight still works, it just re-crops on landing.

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
}

// PLACEHOLDER seed copy — titles are AOIN's real clients (see the roster in
// data/home.ts); the CLIENT/YEAR/ROLE/SCOPE meta and body are stand-ins to be
// replaced per-project via the CMS. Reusing the stills we already have as art.
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
    body: 'Real-time content built for LED and driven live at show resolution. Generative systems, camera-aware grading, and a playback architecture that survives contact with a touring schedule.',
    order: 1,
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
    body: 'Real-time content built for LED and driven live at show resolution. Generative systems, camera-aware grading, and a playback architecture that survives contact with a touring schedule.',
    order: 2,
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
    body: 'Real-time content built for LED and driven live at show resolution. Generative systems, camera-aware grading, and a playback architecture that survives contact with a touring schedule.',
    order: 3,
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
    body: 'Real-time content built for LED and driven live at show resolution. Generative systems, camera-aware grading, and a playback architecture that survives contact with a touring schedule.',
    order: 4,
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
    body: 'Real-time content built for LED and driven live at show resolution. Generative systems, camera-aware grading, and a playback architecture that survives contact with a touring schedule.',
    order: 5,
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
    body: 'Real-time content built for LED and driven live at show resolution. Generative systems, camera-aware grading, and a playback architecture that survives contact with a touring schedule.',
    order: 6,
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
    body: 'Real-time content built for LED and driven live at show resolution. Generative systems, camera-aware grading, and a playback architecture that survives contact with a touring schedule.',
    order: 7,
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
