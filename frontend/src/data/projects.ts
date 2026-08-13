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
  /** Derived — see assignCodes below. Do not author. */
  code: string;
  year: string;
  /** Absolute URL (Payload media). Serves as both the work-list thumbnail and
   *  the project hero (a single authored image). */
  image: string;
  order: number;
  // --- Work-page fields ----------------------------------------------------
  /** Drives the filters + overlay tags + list chips + project meta. */
  capabilities: Capability[];
  /** Overlay + list secondary line, ALL CAPS, e.g. "WORLD TOUR". */
  tour: string;
  /** Overlay bottom line, e.g. "ALL OF IT NOW X PHNTM". */
  collaborator: string;
  // --- Project-page fields -------------------------------------------------
  /** Short lede beside the meta block. */
  summary: string;
  /** Gallery tiles, laid out on the repeating 6-slot grid pattern. */
  gallery: string[];
  /** Figure row under the gallery. */
  stats: { label: string; value: string }[];
  /** Credit groups. Each entry renders TITLE | NAME with the name linking out
   *  to the social `url`. */
  credits: { title: string; entries: { title: string; name: string; url: string }[] }[];
  /** The expandable write-up panel — rich text (Slate nodes). */
  writeup: RichText;
}

export { getProjects, getProject } from '@/lib/payload';
