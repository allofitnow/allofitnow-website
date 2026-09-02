// #58 — responsive-srcset helpers. One source of truth for turning a Payload
// media doc into the URL list a browser picks from.
//
// Grounding (measured 2026-08-30, see #58 layout audit):
//   - `doc.url` is UNTRUSTWORTHY (165 legacy docs carry stored urls, 86 of them
//     absolute LAN-IP values). `filename` is the SSOT — it matches the disk file
//     and the R2 object key. Every URL this module emits is derived from it.
//   - Relative `/media/<filename>` passes the publish translate gate unchanged
//     (that stage only rewrites http://192.168.30.(245|246)/media/ -> /media/).
//   - Spaced filenames: emit the LITERAL path. Browsers percent-encode on
//     request; the Worker decodes (v3c+). Never pre-encode in templates.
//   - Rung ladder (shipped #56/#57): w400/w600/w800/w1000/w1200/w1600, webp q78,
//     withoutEnlargement. Small originals cap: the rungs ABOVE the source width
//     all point at the source-dims file (duplicate-width entries) — dedupe by
//     width before emitting, keeping the LAST entry per width (a later rung
//     pointing at the source file IS the correct cap shape).

/** The subset of a Payload media doc the frontend needs. Optional sizes: video
 *  docs field-initialize `sizes` to empty objects per rung — optional-chain. */
export interface MediaDoc {
  filename?: string;
  mimeType?: string;
  width?: number;
  height?: number;
  alt?: string;
  sizes?: Record<string, { filename?: string; width?: number; height?: number } | undefined>;
}

export const RUNG_ORDER = ['w400', 'w600', 'w800', 'w1000', 'w1200', 'w1600'] as const;

/** /media/<filename> — the public URL for a media file, from the SSOT name. */
export function mediaHref(filename: string): string {
  return '/media/' + filename;
}

/** True when the doc is an image that can have rungs (video docs carry
 *  field-initialized empty `sizes` objects with no filename). */
function rungEntry(doc: MediaDoc, rung: string): { filename: string; width: number } | null {
  const e = doc.sizes?.[rung];
  if (!e || typeof e.filename !== 'string' || e.filename === '') return null;
  if (typeof e.width !== 'number' || e.width <= 0) return null;
  return { filename: e.filename, width: e.width };
}

export interface SrcsetParts {
  /** src fallback = largest available rung (or original). */
  src: string;
  /** srcset value, or '' when the doc has no usable rungs (plain src render). */
  srcset: string;
  /** width/height attrs from the doc (CLS). */
  width?: number;
  height?: number;
}

/** Build src + srcset from a media doc. Dedupes duplicate-width entries by
 *  keeping the LAST per width (cap shape: later rungs point at the source-dims
 *  file — the browser should use that entry for those widths). Returns
 *  srcset:'' when no rungs survive. */
export function buildSrcset(doc: MediaDoc): SrcsetParts {
  const fallback = doc.filename ? mediaHref(doc.filename) : '';
  const byWidth = new Map<number, string>(); // width -> url (later rungs overwrite: cap shape)
  for (const rung of RUNG_ORDER) {
    const e = rungEntry(doc, rung);
    if (!e) continue;
    byWidth.set(e.width, mediaHref(e.filename));
  }
  // Original as the top rung: a wide (>1600w) source adds a descriptor above
  // the ladder; a capped source's rungs already point at the source file, so
  // this is a dedupe no-op there. Requires the doc's intrinsic width.
  if (doc.filename && typeof doc.width === 'number' && doc.width > 0 && !byWidth.has(doc.width)) {
    byWidth.set(doc.width, mediaHref(doc.filename));
  }
  if (byWidth.size === 0) return { src: fallback, srcset: '', width: doc.width, height: doc.height };
  const widths = [...byWidth.keys()].sort((a, v) => a - v);
  const srcset = widths.map((w) => `${byWidth.get(w)} ${w}w`).join(', ');
  // src fallback = the largest rung URL (never larger than needed; the original
  // is still reachable as the last srcset entry ONLY when the original itself
  // is a wider-than-w1600 uncapped image — the ladder's top).
  const src = byWidth.get(widths[widths.length - 1]) ?? fallback;
  return { src, srcset, width: doc.width, height: doc.height };
}

/** True when doc is a video (mimeType or extension) — callers keep <video>. */
export function isVideoDoc(doc: MediaDoc): boolean {
  if (doc.mimeType && /^video\//i.test(doc.mimeType)) return true;
  return /\.(webm|mp4|m4v|mov)(\?|$)/i.test(doc.filename ?? '');
}

/** #103: video rendition rungs from a media doc's sizes map — the video
 *  counterpart of buildSrcset(). Returns entries with a usable filename +
 *  positive width (the ladder hook registers w1280/w854 with measured
 *  geometry; field-initialized empty image-style keys return null and are
 *  skipped), sibling keys resolved as /media/<filename> — RELATIVE by the
 *  #56 convention, so the publish translate stage passes them through
 *  unchanged (same-origin by construction; never derived from API_URL, whose
 *  build-env value points at 127.0.0.1 and is never rewritten — #99 lesson).
 *  The caller's master URL (also derived from filename) tops the ladder. */
export function videoRungs(doc: MediaDoc): { w: number; url: string }[] {
  const rungs: { w: number; url: string }[] = [];
  if (doc.sizes && typeof doc.sizes === 'object') {
    for (const k of Object.keys(doc.sizes)) {
      const e = doc.sizes[k];
      if (
        e && typeof e === 'object' &&
        typeof e.filename === 'string' && e.filename !== '' &&
        typeof e.width === 'number' && e.width > 0
      ) {
        rungs.push({ w: e.width, url: mediaHref(e.filename) });
      }
    }
  }
  rungs.sort((a, b) => a.w - b.w);
  return rungs;
}

/** #103: append the master as the ladder's top rung (the #99 contract —
 *  a >=1280px viewport chooses the master; a ladder-less doc still degrades
 *  to single-source via the master fallback). Callers pass THEIR master URL
 *  form (relative /media/… or the absolute URL the publish translate stage
 *  rewrites) so data-rungs and data-master-src always agree. */
export function appendMasterRung(
  rungs: { w: number; url: string }[],
  masterUrl: string,
  masterW?: number
): { w: number; url: string }[] {
  const w = typeof masterW === 'number' && masterW > 0 ? masterW : 1920;
  rungs.push({ w, url: masterUrl });
  rungs.sort((a, b) => a.w - b.w);
  return rungs;
}

/** #103: poster URL for a wired video doc, by FILENAME CONVENTION — the
 *  ladder hook writes <stem>-poster.webp next to every wired master's rungs
 *  (verified 2026-09-02: 167 wired masters on disk ↔ 167 poster files; no
 *  poster registration exists in the sizes map — posters are NOT mongo docs
 *  except the #99 hero). Callers emit the poster only when videoRungs() is
 *  non-empty: rungs-present ⇒ poster-present is the hook's invariant. */
export function videoPosterHref(doc: MediaDoc): string | null {
  const stem = doc.filename ?? '';
  if (!stem) return null;
  const base = stem.replace(/\.[^.]+$/, '');
  if (!base) return null;
  return mediaHref(`${base}-poster.webp`);
}

/** Compact MediaDoc from a raw Payload REST doc (drops url — untrusted). */
export function toMediaDoc(raw: any): MediaDoc | null {
  if (!raw || typeof raw !== 'object' || typeof raw.filename !== 'string' || raw.filename === '') return null;
  const sizes: MediaDoc['sizes'] = {};
  if (raw.sizes && typeof raw.sizes === 'object') {
    for (const k of Object.keys(raw.sizes)) {
      const e = raw.sizes[k];
      if (e && typeof e === 'object' && typeof e.filename === 'string' && e.filename !== '') {
        sizes[k] = { filename: e.filename, width: e.width, height: e.height };
      }
    }
  }
  return {
    filename: raw.filename,
    mimeType: raw.mimeType,
    width: raw.width,
    height: raw.height,
    alt: raw.alt,
    sizes: Object.keys(sizes).length ? sizes : undefined,
  };
}
