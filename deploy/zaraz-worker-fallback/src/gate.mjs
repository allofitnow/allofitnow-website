// Geo-aware consent gate. Source of truth: project wiki "cookie-compliance" (frozen 2026-08-31).
// Implements #76: the consent cookie is the authoritative record (decision A, wiki
// section 6); this predicate gates the single tracking choke point injectZaraz().

export const OPT_IN = new Set(["AT","BE","BG","HR","CY","CZ","DK","EE","FI","FR","DE","GR","HU","IE","IT","LV","LT","LU","MT","NL","PL","PT","RO","SK","SI","ES","SE","IS","NO","LI","GB","CH"]);

export function parseConsent(cookieHeader) {
  if (!cookieHeader) return null;
  const m = cookieHeader.match(/(?:^|;\s*)aoin_consent=([^;]*)/);
  if (!m) return null;
  try {
    const obj = JSON.parse(decodeURIComponent(m[1]));
    return (obj && typeof obj === "object") ? obj : null;
  } catch { return null; }
}

export function isOptIn(country) {
  // missing/unknown country -> fail CLOSED to the stricter (opt-in) regime
  return !country || OPT_IN.has(country.toUpperCase());
}

// true = tracking may inject
export function gateOpen(country, cookieHeader) {
  const consent = parseConsent(cookieHeader);
  const cats = consent && consent.categories ? consent.categories : null;
  if (isOptIn(country)) {
    // opt-in jurisdictions: ONLY affirmative analytics:true opens the gate
    return !!(cats && cats.analytics === true);
  }
  // notice regimes (everywhere else): default ON; explicit analytics:false closes it
  return !(cats && cats.analytics === false);
}
