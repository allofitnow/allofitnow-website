// scripts/export-payload.js — deterministic per-host export of Payload content
// collections to JSON, so DB edits become git-trackable (issue #153).
//
// Usage:
//   AOIN_HOST_LABEL=245 mongosh --quiet scripts/export-payload.js > data/db/245-payload.json
//
// Scope:
//   IN  : projects, equipment, service-categories, globals (full, secret-stripped)
//         media (metadata only: filename/alt/mimeType/sizes/url/timestamps)
//   OUT : users, payload-preferences, payload-migrations (secrets / internal)
//
// Determinism: keys are sorted recursively, arrays sorted by _id, Dates/BSON
// coerced to stable strings — so a DB edit yields a minimal, meaningful diff.
const DB = "payload";
const s = db.getSiblingDB(DB);

const SECRET_KEYS = new Set([
  "password", "hash", "salt", "token", "resetPasswordToken",
  "resetPasswordExpiration", "loginAttempts", "lockUntil", "apiKey",
]);

// Coerce BSON/JS values to JSON-safe, deterministically-ordered plain values.
function normalize(v) {
  if (Array.isArray(v)) return v.map(normalize);
  if (v instanceof Date) return v.toISOString();
  if (v instanceof ObjectId) return v.toString();
  if (v && typeof v === "object") {
    if (typeof v.toHexString === "function") return v.toString(); // Binary/UUID/etc
    const out = {};
    Object.keys(v).sort().forEach((k) => { out[k] = normalize(v[k]); });
    return out;
  }
  return v;
}

function stripSecrets(doc) {
  for (const k of SECRET_KEYS) delete doc[k];
  return doc;
}

function hostLabel() {
  if (typeof process !== "undefined" && process.env && process.env.AOIN_HOST_LABEL) {
    return process.env.AOIN_HOST_LABEL;
  }
  return "unknown";
}

const result = {
  host: hostLabel(),
  exportedAt: new Date().toISOString(),
  collections: {},
};

for (const c of ["projects", "equipment", "service-categories", "globals"]) {
  const docs = s.getCollection(c).find({}).sort({ _id: 1 }).toArray().map(stripSecrets);
  result.collections[c] = docs;
}

// media: metadata only, keeps the file small and the diff free of binary noise.
const media = s.getCollection("media").find({}, {
  projection: { _id: 1, filename: 1, alt: 1, mimeType: 1, sizes: 1, url: 1, updatedAt: 1, createdAt: 1 },
}).sort({ _id: 1 }).toArray();
result.collections.media = media;

print(JSON.stringify(normalize(result), null, 2));
