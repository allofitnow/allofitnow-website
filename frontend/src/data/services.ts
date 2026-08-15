// /services page content — the four service sections' bottom-left copy and gallery images.
//
// Payload-ready: this SHAPE MIRRORS the Payload `services` global (an array of {slug, desc,
// images[]}). getServiceSections() MERGES the CMS over the local SEED per-slug — CMS copy and
// images win when present, else the seed value stands. This keeps the galleries working while
// the stills are still local (before they're migrated to Payload media). The Payload fetch/
// mapper live in lib/payload.ts (getServicesGlobal). Equipment lives in data/equipment.ts.

export interface ServiceSection {
  /** Stable id — matches the section anchor + capability slug. */
  slug: string;
  /** Bottom-left body copy shown when the section is active. */
  desc: string;
  /** Gallery image URLs, in scrub order. Absolute (Payload media) later; local for now.
   *  Empty for Equipment — its "gallery" is the fleet marquee (see data/equipment.ts). */
  images: string[];
}

// Gallery stills currently ship from the frontend /public bundle; the CMS migration will
// re-home them as Payload uploads (absolute URLs), same as project media.
const pad = (n: number) => String(n).padStart(2, '0');
const rtcImages = [1, 4, 6, 8, 11, 13, 15, 18, 20, 23, 25, 27, 30].map((n) => `/img/services/rtc/${pad(n)}.png`);
const screensImages = [1, 3, 5, 7, 9, 11, 13].map((n) => `/img/services/screens/${pad(n)}.png`);
const mrImages = Array.from({ length: 15 }, (_, i) => `/img/services/mr/${pad(i + 1)}.png`);

const SEED: ServiceSection[] = [
  {
    slug: 'real-time-content',
    desc: 'We use Unreal Engine and Notch to develop Interactive Environments, Live Graphics, and bespoke visual effects for use in fast paced production environments.',
    images: rtcImages,
  },
  {
    slug: 'screens-production',
    desc: 'We offer a comprehensive range of Screens producing, technical direction, and media server programming solutions that ensure your event runs smoothly and leaves a lasting impression on your audience.',
    images: screensImages,
  },
  {
    slug: 'mixed-reality',
    desc: 'We create Mixed Reality experiences that merge the physical and digital worlds — Augmented Reality, Virtual Reality, and Projection Mapping, each tailored to captivate your audience.',
    images: mrImages,
  },
  {
    slug: 'equipment-rental',
    desc: 'All of it Now provides a comprehensive range of equipment rentals for your production. As a long-time Disguise solutions partner and workflow specialist, AOIN has disguise servers available in many configurations.',
    images: [],
  },
];

/** The four service sections, in page order. CMS copy/images merged over the seed per-slug. */
export async function getServiceSections(): Promise<ServiceSection[]> {
  const { getServicesGlobal } = await import('@/lib/payload');
  const cms = await getServicesGlobal();
  if (!cms.length) return SEED;
  return SEED.map((seed) => {
    const c = cms.find((s) => s.slug === seed.slug);
    if (!c) return seed;
    return {
      slug: seed.slug,
      desc: c.desc || seed.desc,
      images: c.images.length ? c.images : seed.images,
    };
  });
}
