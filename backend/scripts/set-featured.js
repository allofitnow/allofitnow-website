import "dotenv/config";

// Set the homepage bleed marquee: flip `featured` on for exactly the run below, in this order,
// and off for everything else. The frontend reads it through getHomeMarquee() (lib/payload.ts),
// which takes the featured set sorted by `featuredOrder` and falls back to every project when
// nothing is featured — which is the state this script exists to leave behind.
//
// Same shape as the other scripts here: logs in with the admin credentials from the environment
// and PATCHes over the REST API, so run it ON the Payload host (or with PAYLOAD_URL pointed at it):
//
//   cd backend && PAYLOAD_ADMIN_PASSWORD=… node scripts/set-featured.js          # dry run
//   cd backend && PAYLOAD_ADMIN_PASSWORD=… node scripts/set-featured.js --apply
//
// Editing the run: change RUN. Order in the array IS the marquee order (featuredOrder 1..n).
//
// Every save fires the Projects publish hook, and that hook runs publish.sh SYNCHRONOUSLY — so a
// run of six is six full site builds back to back and takes minutes, not seconds. It is not hung.
// The upshot is you do not have to rebuild afterwards: the last PATCH leaves the site current.

const PAYLOAD_URL = process.env.PAYLOAD_URL || "http://127.0.0.1:3000";
const ADMIN_EMAIL = process.env.PAYLOAD_ADMIN_EMAIL || "howard.wong@anufutur.com";
const ADMIN_PASSWORD = process.env.PAYLOAD_ADMIN_PASSWORD;
const APPLY = process.argv.includes("--apply");

// Homepage marquee, in order. Slugs, because titles collide — there are two projects titled
// "PESO PLUMA". Anything listed here that the CMS does not have is reported and skipped, so a
// typo or a not-yet-created project can never silently drop out of the run.
const RUN = [
  // "anyma-coachella",   <- belongs first, but no Anyma project exists yet. Create it, then
  //                         uncomment and re-run; everything below shifts down a place on its own.
  "bad-bunny",
  "martin-garrix",
  "linkin-park",
  "peso-pluma",
  "morgan-wallen",
  "encanto-at-the-hollywood-bowl",
];

async function run() {
  if (!ADMIN_PASSWORD) {
    console.error("PAYLOAD_ADMIN_PASSWORD is not set.");
    process.exit(1);
  }
  console.log(`API: ${PAYLOAD_URL}${APPLY ? "" : "   (dry run — pass --apply to write)"}`);

  const loginRes = await fetch(`${PAYLOAD_URL}/api/users/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  if (!loginRes.ok) {
    console.error("Login failed:", await loginRes.text());
    process.exit(1);
  }
  const { token } = await loginRes.json();
  const auth = { Authorization: `JWT ${token}`, "Content-Type": "application/json" };

  const listRes = await fetch(`${PAYLOAD_URL}/api/projects?limit=200&depth=0`, { headers: auth });
  if (!listRes.ok) {
    console.error("Could not list projects:", await listRes.text());
    process.exit(1);
  }
  const docs = (await listRes.json()).docs ?? [];
  const bySlug = new Map(docs.map((d) => [d.slug, d]));

  const missing = RUN.filter((s) => !bySlug.has(s));
  if (missing.length) {
    console.error(`\nNot in the CMS — create these first, or fix the slug:\n  ${missing.join("\n  ")}`);
    process.exit(1);
  }

  // What each project should end up as: listed ones featured at their position, everything else off.
  const wanted = new Map();
  RUN.forEach((slug, i) => wanted.set(slug, i + 1));

  const changes = [];
  for (const doc of docs) {
    const order = wanted.get(doc.slug);
    const featured = order !== undefined;
    const same = !!doc.featured === featured && (!featured || doc.featuredOrder === order);
    if (same) continue;
    changes.push({ doc, featured, order });
  }

  if (!changes.length) {
    console.log("\nNothing to change — the marquee already reads as configured.");
    return;
  }

  console.log(`\n${changes.length} project(s) to update:`);
  for (const c of changes) {
    const was = c.doc.featured ? `featured #${c.doc.featuredOrder ?? "-"}` : "not featured";
    const now = c.featured ? `featured #${c.order}` : "not featured";
    console.log(`  ${(c.doc.slug || "").padEnd(32)} ${was.padEnd(16)} -> ${now}`);
  }

  if (!APPLY) {
    console.log("\nDry run. Re-run with --apply to write.");
    return;
  }

  for (const c of changes) {
    const res = await fetch(`${PAYLOAD_URL}/api/projects/${c.doc.id}`, {
      method: "PATCH",
      headers: auth,
      body: JSON.stringify({ featured: c.featured, featuredOrder: c.featured ? c.order : null }),
    });
    if (!res.ok) {
      console.error(`  FAILED ${c.doc.slug}: ${res.status} ${await res.text()}`);
      process.exit(1);
    }
    console.log(`  ok ${c.doc.slug}`);
  }
  console.log(`\nDone. The marquee now runs: ${RUN.join(" -> ")}`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
