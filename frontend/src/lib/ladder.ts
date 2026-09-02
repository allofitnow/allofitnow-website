// #103 — shared video-rung picker (client). One tier table for every surface
// that emits `video[data-rungs]`: the hero (its controller calls pickRung()
// directly), work galleries + inline write-ups + services galleries + the MR
// orbit + the equipment plate (wired by ladder-boot / services-effects via
// window.__aoinPickRung). Tiers are the proven #99 wireReel logic verbatim:
// saveData or a metered connection (guarded — #94 WebKit/Firefox lesson:
// unguarded navigator.connection reads TypeError) -> smallest rung; viewport
// <768 -> smallest; 768-1279 -> 720-class rung (cap 1280, NOT 854); >=1280 ->
// largest rung (the master).
export interface Rung {
  w: number;
  url: string;
}

export function parseRungs(raw: string | null): Rung[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    const out: Rung[] = [];
    for (const r of v) {
      if (r && typeof r === 'object' && typeof r.w === 'number' && typeof r.url === 'string') {
        out.push({ w: r.w, url: r.url });
      }
    }
    return out;
  } catch {
    return [];
  }
}

export function pickRung(rungs: Rung[], master: string): string {
  if (rungs.length === 0) return master;
  const conn = (navigator as any).connection;
  const saveData = (navigator as any).saveData === true || (conn && conn.saveData) === true;
  const metered = conn && typeof conn.type === 'string' ? /^[23]g$/i.test(conn.type) : false;
  const vw = Math.max(document.documentElement.clientWidth, window.innerWidth || 0);
  const cap = saveData || metered ? rungs[0].w : vw < 768 ? rungs[0].w : vw < 1280 ? 1280 : Infinity;
  let chosen = rungs[rungs.length - 1];
  for (const r of rungs) if (r.w <= cap) chosen = r;
  return chosen.url;
}

// Plain-JS callers (services-effects.js) get the same logic without a module
// import; ladder-boot.ts installs it after its first pickRung call proves the
// module loaded. Signature mirrors pickRung (rungs array + master string).
declare global {
  interface Window {
    __aoinPickRung?: (rungs: Rung[], master: string) => string;
  }
}
if (typeof window !== 'undefined' && typeof (window as any).__aoinPickRung === 'undefined') {
  (window as any).__aoinPickRung = pickRung;
}
