/* Migration: gallery images -> hasMany upload shape, + backfill services.
 *
 *   gallery[].images: [{ image: ObjectId }] -> [ObjectId]   (hasMany upload)
 *   services (new field): backfilled from capabilities where empty
 *
 * Non-destructive, idempotent, dry-run first. Talks to Mongo directly (skips
 * the afterChange publish-webhook). Run ON the Payload host (.245), from backend/:
 *   node migrate-services-gallery.js          # dry run
 *   node migrate-services-gallery.js --apply  # write
 */
require("dotenv").config();
const { MongoClient } = require("mongodb");

const URI = process.env.DATABASE_URI || "mongodb://localhost:27017/payload";
const APPLY = process.argv.includes("--apply");

/** [{ image: ObjectId, _id }] -> [ObjectId]. Idempotent: a bare ObjectId has no
 *  `.image`, so already-flat arrays are left untouched. */
function flattenImages(images) {
  if (!Array.isArray(images)) return { images, changed: false };
  let changed = false;
  const out = images.map((it) => {
    if (it && typeof it === "object" && it.image != null) {
      changed = true;
      return it.image; // the media ObjectId
    }
    return it;
  });
  return { images: out, changed };
}

(async () => {
  const client = new MongoClient(URI);
  await client.connect();
  const col = client.db().collection("projects");
  const docs = await col.find({}).toArray();
  console.log(`Connected to ${URI}`);
  console.log(`${docs.length} projects. Mode: ${APPLY ? "APPLY (writing)" : "DRY RUN (no writes)"}\n`);

  let changed = 0;
  for (const d of docs) {
    const set = {};

    if (Array.isArray(d.gallery)) {
      let galChanged = false;
      for (const row of d.gallery) {
        if (row && Array.isArray(row.images)) {
          const r = flattenImages(row.images);
          if (r.changed) { row.images = r.images; galChanged = true; }
        }
      }
      if (galChanged) set.gallery = d.gallery;
    }

    if ((!Array.isArray(d.services) || d.services.length === 0) &&
        Array.isArray(d.capabilities) && d.capabilities.length) {
      set.services = d.capabilities.slice();
    }

    if (!Object.keys(set).length) continue;
    changed++;
    console.log(`  ${d.slug || d._id}  set[${Object.keys(set).join(",")}]`);
    if (APPLY) await col.updateOne({ _id: d._id }, { $set: set });
  }

  console.log(`\n${APPLY ? "Updated" : "Would update"} ${changed}/${docs.length} docs.`);
  if (!APPLY && changed) console.log("Re-run with --apply to write these changes.");
  await client.close();
})().catch((e) => { console.error(e); process.exit(1); });
