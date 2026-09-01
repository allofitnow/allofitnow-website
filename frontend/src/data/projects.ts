import type { WriteupBlock } from '@/lib/richtext';
// Work / project content — served live from the Payload CMS at build time.
//
// This module exports the shared TYPE definitions (used across components and
// the payload client) and re-exports the async data accessors from the API
// client. There is deliberately NO hardcoded project data here — the CMS is
// the single source of truth; if the API is unreachable the build fails
// loudly instead of silently rendering stale seed copy.

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

/** Payload rich-text (Slate) value — an array of nodes. Rendered via
 *  `renderRichText` in lib/richtext.ts. Kept loose on purpose. */
export type RichText = unknown;

export interface Project {
  slug: string;
  title: string;
  year: string;
  /** Absolute URL (Payload media). Serves as both the work-list thumbnail and
   *  the project hero (a single authored image). */
  image: string;
  /** Populated media doc behind `image` (#58) — srcset source. Null when the
   *  relation came back unpopulated (seed data / shallow fetch): plain src. */
  imageDoc?: import('@/lib/media').MediaDoc | null;
  /** Manual sort nudge — now only a tiebreak within a year (default sort is
   *  chronological, newest first). */
  order: number;
  /** Marks the project for the homepage bleed marquee. */
  featured?: boolean;
  /** Order within the homepage marquee (lower = earlier). */
  featuredOrder?: number;
  // --- Work-page fields ----------------------------------------------------
  /** Indexing only — drives the work filters, tile overlay tags, list chips. */
  capabilities: Capability[];
  /** Shown in the project-page meta block (replaces capabilities there). */
  services: Capability[];
  /** Overlay + list secondary line, ALL CAPS, e.g. "WORLD TOUR". */
  tour: string;
  /** Overlay bottom line, e.g. "ALL OF IT NOW X PHNTM". */
  collaborator: string;
  // --- Project-page fields -------------------------------------------------
  /** Short lede beside the meta block. */
  summary: string;
  /** Gallery arrangements — an ordered list of rows; each row has a layout
   *  preset and the images that fill its slots. */
  gallery: { layout: string; images: string[]; docs?: (import('@/lib/media').MediaDoc | null)[] }[];
  /** Figure row under the gallery. */
  stats: { label: string; value: string }[];
  /** Credit groups. Each entry renders TITLE | NAME with the name linking out
   *  to the social `url`. */
  credits: { title: string; entries: { title: string; name: string; url: string }[] }[];
  /** Coverage links, listed at the foot of the PROJECT INFO panel. Empty for
   *  most projects — the section is dropped entirely when it is. */
  press: { publication: string; title: string; url: string; date: string }[];
  /** The expandable write-up panel — rich text (Slate nodes).
   *  Superseded by `writeupBlocks`; kept for projects not migrated yet. */
  writeup: RichText;
  /** The block form of the same panel. When this has rows it wins over
   *  `writeup` — see renderWriteup in lib/richtext. */
  writeupBlocks: WriteupBlock[];
  /** How that panel flows on desktop: 1 or 2 columns (mobile is always 1). */
  writeupColumns: 1 | 2;
}

export { getProjects, getRoutableProjects, getProject, getHomeMarquee } from '@/lib/payload';
