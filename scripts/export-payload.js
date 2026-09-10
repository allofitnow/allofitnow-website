// scripts/export-payload.js — deterministic per-host export of Payload content
// collections to EJSON, so DB edits become git-trackable (issue #153).
//
// Usage:
//   AOIN_HOST_LABEL=245 mongosh --quiet scripts/export-payload.js > data/db/245-payload.json
//
// Scope:
//   IN  : projects, equipment, service-categories, globals (full, secret-stripped)
//         media (metadata only: filename/alt/mimeType/sizes/timestamps)
//   OUT : users, payload-preferences, payload-migrations, _*_versions (secrets / internal)
//
// Determinism: keys are sorted recursively (sortKeys) while BSON types are left
// intact, then EJSON.stringify preserves types (ObjectId -> $oid, Date -> $date)
// so the file round-trips cleanly into Mongo. Arrays are sorted by _id at the
// query level. dataUpdatedAt = max updatedAt (derived from the data, not per-run).
const DB = "payload";
const s = db.getSiblingDB(DB);

const SECRET_KEYS = new Set([
  "password", "hash", "salt", "token", "resetPasswordToken",
  "resetPasswordExpiration", "loginAttempts", "lockUntil", "apiKey",
]);

// Recursively sort plain-object keys; leave BSON types (ObjectId, Date, Binary,
// Long, etc.) and primitives untouched for EJSON.stringify.
function isPlainObject(v) {
  if (v === null || typeof v !== "object") return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (isPlainObject(v)) {
    const out = {};
    Object.keys(v).sort().forEach((k) => { out[k] = sortKeys(v[k]); });
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
  collections: {},
};

// dataUpdatedAt = latest updatedAt across all exported docs. Stable (derived
// from the data itself), so the export only diffs when the data actually changes
// — no per-run timestamp churn.
let dataUpdatedAt = new Date(0);

for (const c of ["projects", "equipment", "service-categories", "globals"]) {
  const docs = s.getCollection(c).find({}).sort({ _id: 1 }).toArray().map(stripSecrets);
  for (const d of docs) {
    if (d.updatedAt instanceof Date && d.updatedAt > dataUpdatedAt) dataUpdatedAt = d.updatedAt;
  }
  result.collections[c] = docs;
}

// media: metadata only, keeps the file small and the diff free of binary noise.
// url is not stored in Mongo (a computed field), so it is absent from the export.
const media = s.getCollection("media").find({}, {
  projection: { _id: 1, filename: 1, alt: 1, mimeType: 1, sizes: 1, updatedAt: 1, createdAt: 1 },
}).sort({ _id: 1 }).toArray();
for (const d of media) {
  if (d.updatedAt instanceof Date && d.updatedAt > dataUpdatedAt) dataUpdatedAt = d.updatedAt;
}
result.collections.media = media;

result.dataUpdatedAt = dataUpdatedAt.toISOString();

print(EJSON.stringify(sortKeys(result), null, 2));
