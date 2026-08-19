/* One-time migration: re-encode existing CMS video uploads to web-mp4 (the same preset the
 * Media upload hook uses for new uploads — lib/transcodeVideo.js). Every existing gallery
 * video is a large VP9/webm that iOS software-decodes; this converts them to downscaled,
 * hardware-decodable H.264 mp4 (~10× smaller) and repoints their media docs.
 *
 * Non-destructive + idempotent: the source .webm is LEFT in place (unreferenced backup);
 * a doc already on .mp4 is skipped. Talks to Mongo directly (skips the afterChange
 * publish-webhook). Requires ffmpeg on the host.
 *
 * Run ON the Payload host (.245), from backend/:
 *   node scripts/optimize-existing-videos.js           # dry run (transcodes to *.mp4, no DB writes)
 *   node scripts/optimize-existing-videos.js --apply   # transcode + update media docs
 * Then rebuild the frontend (publish.sh) so the SSG bakes the new .mp4 URLs.
 */
require("dotenv").config();
const { MongoClient } = require("mongodb");
const fs = require("fs");
const path = require("path");
const { transcodeFile } = require("../lib/transcodeVideo");

const URI = process.env.DATABASE_URI || "mongodb://localhost:27017/payload";
const APPLY = process.argv.includes("--apply");
const MEDIA_DIR = path.join(__dirname, "..", "media");
const mb = (n) => (n / 1048576).toFixed(1) + "MB";

(async () => {
  const client = new MongoClient(URI);
  await client.connect();
  const col = client.db().collection("media");
  // Candidates: video docs whose stored file isn't already mp4.
  const docs = await col
    .find({ mimeType: { $regex: "^video/" }, filename: { $not: /\.mp4$/i } })
    .toArray();

  console.log(`Connected to ${URI}`);
  console.log(`${docs.length} non-mp4 video(s). Mode: ${APPLY ? "APPLY (writing)" : "DRY RUN (no DB writes)"}\n`);

  let done = 0, skipped = 0, failed = 0, sizeBefore = 0, sizeAfter = 0;

  for (const d of docs) {
    const inPath = path.join(MEDIA_DIR, d.filename);
    const base = d.filename.replace(/\.[^.]+$/, "");
    const outName = base + ".mp4";
    const outPath = path.join(MEDIA_DIR, outName);

    if (!fs.existsSync(inPath)) {
      console.log(`  SKIP  ${d.filename} — source file missing on disk`);
      skipped++;
      continue;
    }
    const inBytes = fs.statSync(inPath).size;
    sizeBefore += inBytes;

    try {
      if (!(fs.existsSync(outPath) && fs.statSync(outPath).size > 0)) {
        await transcodeFile(inPath, outPath); // heavy step — runs in dry-run too so sizes are real
      }
      const outBytes = fs.statSync(outPath).size;
      sizeAfter += outBytes;
      console.log(`  OK    ${d.filename}  ${mb(inBytes)} → ${outName}  ${mb(outBytes)}  (-${(100 - (outBytes / inBytes) * 100).toFixed(0)}%)`);

      if (APPLY) {
        const set = { filename: outName, mimeType: "video/mp4", filesize: outBytes };
        if (typeof d.url === "string") set.url = `/media/${outName}`;
        if (typeof d.thumbnailURL === "string") set.thumbnailURL = `/media/${outName}`;
        await col.updateOne({ _id: d._id }, { $set: set });
      }
      done++;
    } catch (e) {
      console.log(`  FAIL  ${d.filename} — ${e && e.message ? e.message : e}`);
      failed++;
    }
  }

  console.log(
    `\n${APPLY ? "Applied" : "Dry run"}: ${done} transcoded, ${skipped} skipped, ${failed} failed.` +
    `\nTotal: ${mb(sizeBefore)} → ${mb(sizeAfter)} (${sizeBefore ? (100 - (sizeAfter / sizeBefore) * 100).toFixed(0) : 0}% smaller).` +
    `\nSource .webm files left in place as backup (unreferenced — safe to delete once verified).` +
    (APPLY ? "\nNext: rebuild the frontend (publish.sh) to bake the new .mp4 URLs." : "\nRe-run with --apply to update the media docs.")
  );

  await client.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
