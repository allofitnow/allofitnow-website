/* One-off, idempotent migration for the `services` field going select → relationship, plus the
 * `collaborator` prefix strip. Run ON .245 AFTER Payload has been restarted with the new schema
 * (so the `service-categories` collection already exists with its indexes).
 *
 *   DRY-RUN (default, writes nothing):  cd backend && node scripts/migrate-services.js
 *   APPLY  (writes):                    cd backend && APPLY=1 node scripts/migrate-services.js
 *
 * What it does, per project (read raw values straight from Mongo so the pre-migration STRINGS are
 * still visible even though the field schema is now a relationship):
 *   - services: distinct label strings → find-or-create a `service-categories` doc each, then set
 *     the project's `services` to the array of those category ObjectIds (Payload's hasMany
 *     single-relationTo storage shape).
 *   - collaborator: strip a leading "ALL OF IT NOW X " so the field holds the PARTNER NAME only.
 *
 * Idempotent: a second run is a no-op (services already ObjectIds → skipped; collaborator already
 * stripped → unchanged). Take a mongodump of `projects` + `service-categories` before APPLY.
 */
const mongoose = require('mongoose');

const URI = process.env.DATABASE_URI || 'mongodb://127.0.0.1:27017/payload';
const APPLY = process.env.APPLY === '1';
const stripPrefix = (s) => String(s).replace(/^ALL\s+OF\s+IT\s+NOW\s*X\s*/i, '').trim();

(async () => {
  await mongoose.connect(URI);
  const db = mongoose.connection.db;
  console.log(`connected: db="${db.databaseName}"  mode=${APPLY ? 'APPLY' : 'DRY-RUN'}`);
  const cols = (await db.listCollections().toArray()).map((c) => c.name);
  if (!cols.includes('service-categories')) {
    console.warn('! "service-categories" collection not found — has Payload been restarted with the new schema? Continuing (APPLY would create it).');
  }
  const Projects = db.collection('projects');
  const Cats = db.collection('service-categories');

  const projects = await Projects.find({}).toArray();
  console.log(`projects: ${projects.length}`);

  // 1) distinct service label strings across all projects
  const labels = new Set();
  for (const p of projects) {
    for (const s of Array.isArray(p.services) ? p.services : []) {
      if (typeof s === 'string' && s.trim()) labels.add(s.trim());
    }
  }
  console.log('distinct service labels:', [...labels]);

  // 2) find-or-create a category per label → label→ObjectId
  const labelToId = new Map();
  for (const label of labels) {
    const existing = await Cats.findOne({ label });
    if (existing) {
      labelToId.set(label, existing._id);
      console.log(`  = category "${label}" exists → ${existing._id}`);
    } else if (APPLY) {
      const now = new Date();
      const r = await Cats.insertOne({ label, order: null, createdAt: now, updatedAt: now });
      labelToId.set(label, r.insertedId);
      console.log(`  + created category "${label}" → ${r.insertedId}`);
    } else {
      labelToId.set(label, null);
      console.log(`  + WOULD create category "${label}"`);
    }
  }

  // 3) per project: services strings → ids; collaborator → partner-only
  let svcChanged = 0, collabChanged = 0;
  for (const p of projects) {
    const set = {};
    const svc = Array.isArray(p.services) ? p.services : [];
    if (svc.length && svc.some((s) => typeof s === 'string')) {
      const ids = svc.map((s) => labelToId.get(String(s).trim())).filter((x) => x != null);
      set.services = ids;
      svcChanged++;
      console.log(`  [${p.slug}] services ${JSON.stringify(svc)} → ${APPLY ? ids.length + ' refs' : 'WOULD map ' + svc.length}`);
    }
    const collab = typeof p.collaborator === 'string' ? p.collaborator.trim() : '';
    if (collab) {
      const partner = stripPrefix(collab);
      if (partner !== collab) {
        set.collaborator = partner;
        collabChanged++;
        console.log(`  [${p.slug}] collaborator "${collab}" → "${partner}"`);
      }
    }
    if (APPLY && Object.keys(set).length) {
      set.updatedAt = new Date();
      await Projects.updateOne({ _id: p._id }, { $set: set });
    }
  }

  console.log(`\n${APPLY ? 'APPLIED' : 'DRY-RUN'}: services updates=${svcChanged}, collaborator strips=${collabChanged}`);
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
