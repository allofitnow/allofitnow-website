/* One-off migration: old Projects schema -> v2.
 *
 *   hero/thumb          -> image            (single key image; copies hero)
 *   writeup {lead,body} -> writeup []       (Slate rich text)
 *   credits {role,handle}-> {title,name,url} (name links to the social url)
 *   role, scope, thumb, hero                 (dropped)
 *
 * Non-destructive: maps fields in place, deletes NO documents. Talks to Mongo
 * directly so Payload's afterChange publish-webhook does NOT fire 35 times.
 * Idempotent: re-running is safe (already-migrated docs are left as-is).
 *
 * Run ON THE PAYLOAD HOST (.245), from the backend/ dir:
 *   node scripts/migrate-v2-schema.js          # dry run — report only, writes nothing
 *   node scripts/migrate-v2-schema.js --apply  # apply the changes
 */
require("dotenv").config();
const { MongoClient } = require("mongodb");

const URI = process.env.DATABASE_URI || "mongodb://localhost:27017/payload";
const APPLY = process.argv.includes("--apply");

/** Old writeup group { lead?, body?: [{ paragraph }] } -> Slate node array. */
function toSlate(writeup) {
  if (Array.isArray(writeup)) return writeup; // already rich text
  const nodes = [];
  if (writeup && writeup.lead) nodes.push({ children: [{ text: String(writeup.lead) }] });
  if (writeup && Array.isArray(writeup.body)) {
    for (const b of writeup.body) {
      if (b && b.paragraph) nodes.push({ children: [{ text: String(b.paragraph) }] });
    }
  }
  if (nodes.length === 0) nodes.push({ children: [{ text: "" }] });
  return nodes;
}

/** Mutate credit entries in place: {role,handle} -> {title,name,url}. Keeps _id. */
function migrateCredits(credits) {
  if (!Array.isArray(credits)) return { credits, changed: false };
  let changed = false;
  for (const group of credits) {
    if (!group || !Array.isArray(group.entries)) continue;
    for (const e of group.entries) {
      if (!e) continue;
      if (e.title == null && e.role != null) { e.title = e.role; changed = true; }
      if (e.name == null && e.handle != null) { e.name = e.handle; changed = true; }
      if (e.url == null) { e.url = e.handle ? `https://instagram.com/${e.handle}` : ""; changed = true; }
      if ("role" in e) { delete e.role; changed = true; }
      if ("handle" in e) { delete e.handle; changed = true; }
    }
  }
  return { credits, changed };
}

(async () => {
  const client = new MongoClient(URI);
  await client.connect();
  const db = client.db(); // database name comes from the connection string
  const names = (await db.listCollections().toArray()).map((c) => c.name);
  if (!names.includes("projects")) {
    console.error(`No "projects" collection in this DB. Collections: ${names.join(", ")}`);
    process.exit(1);
  }
  const col = db.collection("projects");
  const docs = await col.find({}).toArray();
  console.log(`Connected to ${URI}`);
  console.log(`${docs.length} projects found. Mode: ${APPLY ? "APPLY (writing)" : "DRY RUN (no writes)"}\n`);

  let changed = 0;
  for (const d of docs) {
    const set = {};
    const unset = {};

    if (d.image == null && (d.hero != null || d.thumb != null)) {
      set.image = d.hero != null ? d.hero : d.thumb;
    }
    if (!Array.isArray(d.writeup)) {
      set.writeup = toSlate(d.writeup);
    }
    const cr = migrateCredits(d.credits);
    if (cr.changed) set.credits = cr.credits;

    for (const f of ["role", "scope", "thumb", "hero", "client", "body"]) {
      if (f in d) unset[f] = "";
    }

    const nSet = Object.keys(set).length;
    const nUnset = Object.keys(unset).length;
    if (!nSet && !nUnset) continue;

    changed++;
    console.log(`  ${d.slug || d._id}  set[${Object.keys(set).join(",") || "-"}]  unset[${Object.keys(unset).join(",") || "-"}]`);

    if (APPLY) {
      const update = {};
      if (nSet) update.$set = set;
      if (nUnset) update.$unset = unset;
      await col.updateOne({ _id: d._id }, update);
    }
  }

  console.log(`\n${APPLY ? "Updated" : "Would update"} ${changed}/${docs.length} docs.`);
  if (!APPLY && changed) console.log("Re-run with --apply to write these changes.");
  await client.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
