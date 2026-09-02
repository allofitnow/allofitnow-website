// Studio (About) page content. The TEAM roster is now CMS-editable via the Payload `about`
// global — getRoster() merges it over the seed below (see the note on `team`). The statement,
// profile prose and band images are still hardcoded here (edit in this file). Copy is supplied
// by the studio; do not rewrite it here. The contract for every field (and what deliberately is
// NOT a field) shipped with the redesign handoff (ABOUT-PAYLOAD.md). Rendered by src/pages/studio.astro.

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

// The stills under the statement. Three, laid out left to right and never
// cropped: the row is sized so every image shares one height while keeping its
// own width, so the aspect ratios may differ freely (they do — two near-square
// neon plates either side of a 16:9 studio drawing). width/height are the
// intrinsic pixels; they go on the <img> so the band reserves its space before
// the files land, AND they drive the --ar flex ratio that equalises the heights,
// so they must match the real files. That coupling is why the filenames carry a
// -vN: /assets is served `Cache-Control: public, immutable, max-age=2592000`, so
// overwriting an image in place leaves returning browsers holding the old pixels
// against the new ratios, and the row silently stops lining up. Changing a plate
// means a new filename, not just a new file. Two of the three carry alpha and are drawn
// straight onto the page black — do not give them a background plate.
export const band: MediaRef[] = [
  {
    url: '/assets/about-band-all-of-it-now-v2.webp',
    width: 2008,
    height: 1627,
    alt: 'ALL OF IT NOW spelled out in white neon tubing',
  },
  {
    url: '/assets/about-band-studio-v2.webp',
    width: 3840,
    height: 2160,
    alt: 'Line drawing of the studio floor: edit desks, monitors, racked servers and shelved road cases',
  },
  {
    url: '/assets/about-band-vr-v2.webp',
    width: 1725,
    height: 1669,
    alt: 'VIRTUAL REALITY spelled out in white neon tubing',
  },
];

// Studio profile. Two paragraphs render as the intended two-column set; one or
// three still lay out. Plain text, no markup.
export const profile: string[] = [
  "All of it Now (AOIN) is a cutting-edge creative agency based in Los Angeles, California. With a rich background in film/TV production, information technology, and brand marketing, we specialize in crafting immersive digital experiences that captivate and inspire. From live event production and virtual/augmented reality (VR/AR) to interactive installations and custom motion graphics, our team pushes the boundaries of what's possible through technology-driven design.",
  "Our passion lies at the intersection of creativity and innovation, partnering with top brands, artists, and events to deliver unforgettable experiences. Utilizing industry-leading tools such as Notch and Disguise, we bring projects to life in real-time, whether it's for concerts, permanent installations, or virtual production. At AOIN, we strive to exceed expectations and redefine the potential of digital storytelling.",
];

// Roster SEED — the fallback when the CMS `about` global is empty/unreachable (getRoster()
// prefers the CMS). In the CMS, array order is render order (drag to reorder); here, `order`
// decides render position, not array position. Numbered in tens so a new hire slots in without
// renumbering the file. Currently alphabetical by surname, Jude last.
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

/** Roster in render order (SEED). Sorted copy — `team` itself is never mutated.
 *  This is the fallback; getRoster() below prefers the CMS when it's populated. */
export const roster = (): TeamMember[] => [...team].sort((a, b) => a.order - b.order);

/** Team roster for the page. Prefers the CMS `about` global (drag-sortable — array order
 *  IS render order, mapped onto `order` so the shape is unchanged), and falls back to the
 *  local seed above when the global is empty or the API is unreachable. This is the accessor
 *  the page should call; `roster()` stays the pure-seed path it delegates to. */
export async function getRoster(): Promise<TeamMember[]> {
  const { getAboutTeam } = await import('@/lib/payload');
  const cms = await getAboutTeam();
  if (!cms.length) return roster();
  return cms.map((m, i) => ({ name: m.name, title: m.title, order: (i + 1) * 10 }));
}

/* Every title is required: a missing one is a content gap that should stop the
   build, not ship as an empty line. This runs at module scope, so `astro build`
   and `astro check` both fail with the names that need filling in. */
function assertStudio(): void {
  const problems: string[] = [];

  if (statement.length !== 4) {
    problems.push(`statement: expected 4 lines, got ${statement.length}`);
  }
  if (band.length !== 3) {
    problems.push(`band: expected 3 images, got ${band.length}`);
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
