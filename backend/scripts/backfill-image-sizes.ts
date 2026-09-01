import mongoose from "mongoose";
import sharp from "sharp";
import sanitizeFilename from "sanitize-filename";
import fs from "fs";
import { execSync } from "child_process";

// #57 one-shot backfill. Replicates #56 SHIPPED semantics exactly:
// ALL 6 rungs per image doc; rungs wider than source are CAPPED (withoutEnlargement)
// -> source-dims q78 re-encode file; doc.sizes entry carries source dims.
// _id/filename untouched; $set sizes.* only. Idempotent: skips docs with any non-empty rung.
// Flags: --dry (no writes), --only <filename> (single doc), --limit <n> (stop after n docs).

const RUNGS = [400, 600, 800, 1000, 1200, 1600];
const MEDIA_DIR = "/root/projects/allofitnow-website/backend/media";
const ANIMATED = new Set(["image/webp", "image/gif"]);
const RESIZABLE = ["image/jpeg", "image/png", "image/gif", "image/webp", "image/tiff"];
const DRY = process.argv.includes("--dry");
const ONLY = (() => { const i = process.argv.indexOf("--only"); return i > 0 ? process.argv[i + 1] : null; })();
const LIMIT = (() => { const i = process.argv.indexOf("--limit"); return i > 0 ? parseInt(process.argv[i + 1], 10) : 0; })();

function df() { return execSync("df -h / | tail -1").toString().trim(); }

(async () => {
  console.log("DF_BEFORE", df());
  const uri = process.env.DATABASE_URI;
  if (!uri) throw new Error("MONGODB_URI not set");
  await mongoose.connect(uri);
  const Media = mongoose.connection.collection("media");

  const docs = await Media.find({ mimeType: { $in: RESIZABLE } }, { projection: { filename: 1, mimeType: 1, sizes: 1 } }).toArray();
  console.log("IMAGE_DOCS", docs.length);

  const csv: string[] = ["id,base,srcW,srcH,rung,file,outW,outH,bytes,capped,action"];
  let generated = 0, docsDone = 0, skippedAlready = 0, skippedMissing = 0;

  for (const doc of docs as any[]) {
    if (ONLY && doc.filename !== ONLY) continue;
    const hasRungs = doc.sizes && RUNGS.some((w) => doc.sizes["w" + w] && doc.sizes["w" + w].filename);
    if (hasRungs) { skippedAlready++; continue; }
    const srcPath = MEDIA_DIR + "/" + doc.filename;
    if (!fs.existsSync(srcPath)) { skippedMissing++; csv.push([doc._id, doc.filename, "", "", "", "MISSING", "", "", "", "skip"].join(",")); continue; }
    const base = sanitizeFilename(doc.filename.substring(0, doc.filename.lastIndexOf(".")) || doc.filename);
    const animated = ANIMATED.has(doc.mimeType);
    const input = fs.readFileSync(srcPath);
    const srcMeta = await sharp(input, animated ? { animated: true } : {}).metadata();
    if ((srcMeta as any).pages) console.log("ANIMATED_DOC", doc.filename, "pages=", (srcMeta as any).pages);
    const setOps: any = {};
    for (const w of RUNGS) {
      const { data, info } = await sharp(input, animated ? { animated: true } : {})
        .rotate()
        .resize({ width: w, withoutEnlargement: true })
        .toFormat("webp", { quality: 78 })
        .toBuffer({ resolveWithObject: true });
      const capped = info.width < w;
      const fname = base + "-" + info.width + "x" + info.height + ".webp";
      if (!DRY) fs.writeFileSync(MEDIA_DIR + "/" + fname, data);
      setOps["sizes.w" + w] = { filename: fname, width: info.width, height: info.height, mimeType: "image/webp", filesize: data.length };
      generated++;
      csv.push([doc._id, base, srcMeta.width, srcMeta.height, "w" + w, fname, info.width, info.height, data.length, capped, DRY ? "dry" : "written"].join(","));
    }
    if (!DRY) await Media.updateOne({ _id: doc._id }, { $set: setOps });
    docsDone++;
    if (docsDone % 25 === 0) console.log("PROGRESS", docsDone, "docs,", generated, "rungs");
    if (LIMIT && docsDone >= LIMIT) break;
  }
  fs.writeFileSync("/tmp/p57-report.csv", csv.join("\n"));
  console.log(JSON.stringify({ generated, docsDone, skippedAlready, skippedMissing, dry: DRY }));
  console.log("FILES_NOW", execSync("ls " + MEDIA_DIR + " | wc -l").toString().trim());
  console.log("DF_AFTER", df());
  await mongoose.disconnect();
  process.exit(0);
})().catch((e) => { console.error("BACKFILL_FAIL", e && e.message ? e.message : e); process.exit(1); });
