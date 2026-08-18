// Studio (About) page content — hardcoded now, Payload-shaped for phase 2.
// Copy is supplied by the studio; do not rewrite it here. The contract for
// every field (and what deliberately is NOT a field) shipped with the redesign
// handoff (ABOUT-PAYLOAD.md). Rendered by src/pages/studio.astro.

/** A Payload media upload, as the REST/GraphQL response returns it. Phase 1
 *  values point at files in /public/assets; phase 2 they arrive from the API
 *  unchanged, so nothing downstream has to care which. */
export interface MediaRef {
  url: string;
  width: number;
  height: number;
  alt: string;
}

/** One roster entry. `order` is the render position — see the note on `team`. */
export interface TeamMember {
  name: string;
  title: string;
  order: number;
}

export const meta = {
  title: 'Studio — All Of It Now',
  description: 'All Of It Now is a creative technology studio.',
};

// The positioning statement, one array entry per rendered line. The breaks are
// the statement's rhythm, not wrapping: the page sets each line `nowrap`, so a
// longer edit overflows visibly instead of silently re-wrapping. Four lines.
export const statement: string[] = [
  'ALL OF IT NOW IS A CREATIVE TECHNOLOGY STUDIO,',
  'PARTNERING WITH AGENCIES AND ARTISTS TO PUSH',
  'THE BOUNDARIES OF REAL-TIME DESIGN ACROSS',
  'TV, FILM, CORPORATE EVENTS, AND LIVE MUSIC.',
];

// The pair of stills under the statement. Exactly two, 16:9, cool-cast or B&W
// live-show photography. width/height are the intrinsic pixels — they go on the
// <img> so the band reserves its space before the files land. The two files in
// /public/assets are TEMPORARY placeholders — swap for real show photography.
export const band: [MediaRef, MediaRef] = [
  {
    url: '/assets/about-band-1.webp',
    width: 1920,
    height: 1080,
    alt: 'LED volume mid-show, cool cast',
  },
  {
    url: '/assets/about-band-2.webp',
    width: 1920,
    height: 1080,
    alt: 'Stage rig from the floor, crowd silhouetted',
  },
];

// Studio profile. Two paragraphs render as the intended two-column set; one or
// three still lay out. Plain text, no markup.
export const profile: string[] = [
  "All of it Now (AOIN) is a cutting-edge creative agency based in Los Angeles, California. With a rich background in film/TV production, information technology, and brand marketing, we specialize in crafting immersive digital experiences that captivate and inspire. From live event production and virtual/augmented reality (VR/AR) to interactive installations and custom motion graphics, our team pushes the boundaries of what's possible through technology-driven design.",
  "Our passion lies at the intersection of creativity and innovation, partnering with top brands, artists, and events to deliver unforgettable experiences. Utilizing industry-leading tools such as Notch and Disguise, we bring projects to life in real-time, whether it's for concerts, permanent installations, or virtual production. At AOIN, we strive to exceed expectations and redefine the potential of digital storytelling.",
];

// Roster. `order` decides the render position, not array position — Payload's
// drag-sort writes a number, and a hand edit here should behave the same way.
// Numbered in tens so a new hire slots in without renumbering the file.
// Currently alphabetical by surname, Jude last.
export const team: TeamMember[] = [
  { name: 'CHRISTOPHER BENZ', title: 'TITLE TBD', order: 10 },
  { name: 'MYKEL BOOKER', title: 'SYSTEMS ENGINEER', order: 20 },
  { name: 'DANNY FIRPO', title: 'CO-FOUNDER AND CEO', order: 30 },
  { name: 'HARRISON HADLEY', title: 'TITLE TBD', order: 40 },
  { name: 'STELLA KINOSHITA', title: 'TITLE TBD', order: 50 },
  { name: 'BERTO MORA', title: 'CTO AND PARTNER', order: 60 },
  { name: 'NICOLE PLAZA', title: 'EXECUTIVE PRODUCER', order: 70 },
  { name: 'VISHAL SHARMA', title: 'PROGRAMMER AND DESIGNER', order: 80 },
  { name: 'MASON THOMPSON', title: 'TITLE TBD', order: 90 },
  { name: 'HOWARD WONG', title: 'CO-FOUNDER AND PRESIDENT', order: 100 },
  { name: 'JUDE', title: 'TITLE TBD', order: 110 },
];

/** Roster in render order. Sorted copy — `team` itself is never mutated. */
export const roster = (): TeamMember[] => [...team].sort((a, b) => a.order - b.order);

/* Every title is required: a missing one is a content gap that should stop the
   build, not ship as an empty line. This runs at module scope, so `astro build`
   and `astro check` both fail with the names that need filling in. */
function assertStudio(): void {
  const problems: string[] = [];

  if (statement.length !== 4) {
    problems.push(`statement: expected 4 lines, got ${statement.length}`);
  }
  if (band.length !== 2) {
    problems.push(`band: expected 2 images, got ${band.length}`);
  }
  band.forEach((image, i) => {
    if (!image.url || !image.alt || !image.width || !image.height) {
      problems.push(`band[${i}]: needs url, alt, width and height`);
    }
  });
  if (!profile.length) problems.push('profile: needs at least one paragraph');

  const missing = team.filter((m) => !m.title?.trim()).map((m) => m.name);
  if (missing.length) problems.push(`team: title missing for ${missing.join(', ')}`);

  const orders = team.map((m) => m.order);
  if (new Set(orders).size !== orders.length) {
    problems.push('team: order numbers must be unique');
  }
  if (orders.some((o) => !Number.isFinite(o))) {
    problems.push('team: every member needs a numeric order');
  }

  if (problems.length) {
    throw new Error(`src/data/studio.ts is incomplete:\n  - ${problems.join('\n  - ')}`);
  }
}

assertStudio();
