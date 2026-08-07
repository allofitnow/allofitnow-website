// Home page content — hardcoded now, Payload-shaped for phase 2.
// Copy is salvage-and-restructure from the existing site; framing is the redesign.

export interface NavLink {
  label: string;
  href: string;
}

export interface ServiceItem {
  /** Title split into two words so it can justify edge-to-edge on one line. */
  title: [string, string];
  blurb: string;
  href: string;
}

export interface SocialLink {
  label: string;
  href: string;
}

export const reel = {
  // The Vimeo stand-in from the prototype. Replace when the real reel is cut.
  vimeoId: '1153696598',
  hash: '028fbff75b',
};

export const location = 'LOS ANGELES, CALIFORNIA';
export const tagline = 'REDEFINING THE BOUNDARIES OF REAL-TIME CONTENT';

export const nav: NavLink[] = [
  { label: 'WORK', href: '#work' },
  { label: 'SERVICES', href: '#services' },
  { label: 'STUDIO', href: '#studio' },
  { label: 'CONTACT', href: '#contact' },
];

export const social: SocialLink[] = [
  { label: 'INSTAGRAM', href: 'https://www.instagram.com/allofitnow' },
  { label: 'LINKEDIN', href: 'https://www.linkedin.com/company/all-of-it-now' },
];

export const hero = {
  // The wordmark assembles from these four, one per corner.
  words: ['ALL', 'OF', 'IT', 'NOW'],
  cue: 'SCROLL DOWN',
};

export const about = {
  // Two justified display lines; each inner array is the words on that line.
  display: [
    ['WE', 'INNOVATE'],
    ['VISUAL', 'EXPERIENCES'],
  ] as [string, string][],
  dropcap: 'AOIN',
  statement:
    'IS A CREATIVE TECHNOLOGY STUDIO, PARTNERING WITH AGENCIES AND ARTISTS TO PUSH THE BOUNDARIES OF REAL-TIME DESIGN ACROSS TV, FILM, CORPORATE EVENTS, AND LIVE MUSIC.',
  workCue: 'VIEW SELECTED WORK',
};

// Bleed carousel — the homepage marquee. Just an ordered list of stills; no
// baked-in names (the roster churns and Payload will own it — this becomes the
// `homepage.marquee` relationship to `projects`). Add/remove/reorder freely.
export const bleed: string[] = [
  '/assets/bad-bunny.webp',
  '/assets/rauw-alejandro.webp',
  '/assets/martin-garrix.webp',
  '/assets/peso-pluma.webp',
  '/assets/melanie-martinez.webp',
  '/assets/good-charlote.webp',
  '/assets/renee-rapp.webp',
];

export const servicesLabels = { left: 'STUDIO', right: 'CAPABILITIES' };

export const services: ServiceItem[] = [
  {
    title: ['REAL-TIME', 'CONTENT'],
    blurb: 'GENERATIVE AND PRE-RENDERED CONTENT BUILT FOR LED, DRIVEN LIVE AT SHOW RESOLUTION.',
    href: '#studio',
  },
  {
    title: ['SCREENS', 'PRODUCTION'],
    blurb:
      'SCREENS DIRECTION, PLAYBACK, AND ON-SITE ENGINEERING FOR ARENA AND STADIUM PRODUCTIONS.',
    href: '#studio',
  },
  {
    title: ['MIXED', 'REALITY'],
    blurb:
      'AR, XR, AND VIRTUAL PRODUCTION STAGES — CAMERA TRACKING, CALIBRATION, AND REAL-TIME COMPOSITING.',
    href: '#studio',
  },
  {
    title: ['EQUIPMENT', 'RENTAL'],
    blurb: 'MEDIA SERVERS, TRACKING SYSTEMS, AND PROCESSING, PACKAGED AND SUPPORTED FOR TOUR OR STUDIO.',
    href: '#studio',
  },
];

export const clientsLabels = { left: 'SELECTED', right: 'CLIENTS' };

// Justified roster — the controller solves line breaks at runtime.
export const clients: string[] = [
  'BAD BUNNY', 'MARTIN GARRIX', 'CHILDISH GAMBINO', 'RENÉE RAPP', 'BAD OMENS',
  'THE KID LAROI', 'QUEVEDO', 'ANDERSON PAAK', 'LINKIN PARK', 'KENDRICK LAMAR',
  'AQUEREUM', 'PESO PLUMA', 'MELANIE MARTINEZ', 'FALLOUT', 'RIOT GAMES', 'DISNEY',
  'FLUME', 'KISS', 'COLDPLAY', 'BTS', 'MCENROE VS MCENROE', "AMERICA'S GOT TALENT",
  'KASKADE', 'DEMI LOVATO', 'FACEBOOK OCULUS', 'MTV MILLENNIAL AWARDS', 'J COLE',
  'HALSEY', 'AUDI', 'VOX', 'EPSON', 'PRIME VIDEO', 'FORTNITE', 'ROCKET LEAGUE',
  'INFINITI', 'MOFAD', 'THE VOICE', 'EXTENDING REALITY',
];

export const footer = {
  info: [
    'ALL OF IT NOW IS A TECHNICAL SOLUTIONS',
    'PROVIDER FOR REAL-TIME CONTENT ACROSS',
    'TV / FILM, CORPORATE EVENTS, AND LIVE MUSIC.',
  ],
  legal: ['ALL OF IT NOW. ESTD. 2014.', '2026 ALL RIGHTS RESERVED.'],
  navPrimary: [
    { label: 'WORK', href: '#work' },
    { label: 'SERVICES', href: '#services' },
    { label: 'STUDIO', href: '#studio' },
  ] as NavLink[],
  navSecondary: [{ label: 'CONTACT', href: '#contact' }] as NavLink[],
  social: [
    ...social,
    { label: 'INFO@ALLOFITNOW.COM', href: 'mailto:info@allofitnow.com' },
  ] as SocialLink[],
  address: ['1651 S CENTRAL AVE', 'GLENDALE, CA 91204', 'UNITED STATES'],
};
