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

export interface Project {
  slug: string;
  title: string;
  /** Derived — see assignCodes below. Do not author. */
  code: string;
  client: string;
  year: string;
  role: string;
  scope: string;
  /** Absolute URL (Payload media). */
  thumb: string;
  /** Absolute URL (Payload media). */
  hero: string;
  body: string;
  order: number;
  // --- Work-page fields ----------------------------------------------------
  /** Drives the filters + overlay tags + list chips. 2 per project today. */
  capabilities: Capability[];
  /** Overlay + list secondary line, ALL CAPS, e.g. "WORLD TOUR". */
  tour: string;
  /** Overlay bottom line, e.g. "ALL OF IT NOW X PHNTM". */
  collaborator: string;
  // --- Project-page fields -------------------------------------------------
  /** Short lede beside the meta block — distinct from `body`. */
  summary: string;
  /** Gallery tiles, laid out on the repeating 6-slot grid pattern. */
  gallery: string[];
  /** Figure row under the gallery. */
  stats: { label: string; value: string }[];
  /** Credit groups; handles are IG usernames (lowercase, uppercased in CSS). */
  credits: { title: string; entries: { role: string; handle: string }[] }[];
  /** The expandable write-up panel: one lede + body paragraphs. */
  writeup: { lead: string; body: string[] };
}

export { getProjects, getProject } from '@/lib/payload';
