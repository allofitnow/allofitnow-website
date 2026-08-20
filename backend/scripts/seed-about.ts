/* One-time seed: populate the `about` global's team roster from the frontend's original
 * hardcoded list, so the CMS opens pre-filled instead of empty. (The frontend still falls
 * back to its local seed when this global is empty, so the page never blanks — this just
 * hands the editor the current roster to start from.)
 *
 * Idempotent: SKIPS if about.team already has members, so a re-run never clobbers CMS
 * edits. Pass --force to overwrite with this list.
 *
 * Uses the Payload local API (same runtime as the live server), so the global is stored
 * exactly as the admin expects. Run ON the Payload host (.245), from backend/:
 *   npx ts-node --transpile-only scripts/seed-about.ts            # seed if empty
 *   npx ts-node --transpile-only scripts/seed-about.ts --force    # overwrite
 */
import "dotenv/config";
import payload from "payload";

// The roster as it shipped hardcoded in frontend/src/data/studio.ts (render order).
const TEAM: { name: string; title: string }[] = [
  { name: "CHRISTOPHER BENZ", title: "TITLE TBD" },
  { name: "MYKEL BOOKER", title: "SYSTEMS ENGINEER" },
  { name: "DANNY FIRPO", title: "CO-FOUNDER AND CEO" },
  { name: "HARRISON HADLEY", title: "TITLE TBD" },
  { name: "STELLA KINOSHITA", title: "TITLE TBD" },
  { name: "BERTO MORA", title: "CTO AND PARTNER" },
  { name: "NICOLE PLAZA", title: "EXECUTIVE PRODUCER" },
  { name: "VISHAL SHARMA", title: "PROGRAMMER AND DESIGNER" },
  { name: "MASON THOMPSON", title: "TITLE TBD" },
  { name: "HOWARD WONG", title: "CO-FOUNDER AND PRESIDENT" },
  { name: "JUDE", title: "TITLE TBD" },
];

const FORCE = process.argv.includes("--force");

(async () => {
  await payload.init({
    secret: process.env.PAYLOAD_SECRET || "dev-secret",
    local: true,
  });

  const existing: any = await payload.findGlobal({ slug: "about" });
  const current = Array.isArray(existing?.team) ? existing.team : [];

  if (current.length && !FORCE) {
    console.log(
      `about.team already has ${current.length} member(s) — skipping (pass --force to overwrite).`
    );
    process.exit(0);
  }

  const updated: any = await payload.updateGlobal({ slug: "about", data: { team: TEAM } });
  console.log(`Seeded about.team with ${updated?.team?.length ?? 0} member(s).`);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
