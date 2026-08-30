// alt-backfill.ts - #62: regenerate alt text for target image docs via
// CF Workers AI llava-1.5-7b. Pattern of #57 (mongoose direct, $set alt only).
// Usage:
//   npx ts-node --transpile-only scripts/alt-backfill.ts --calibrate   (first 10, MUST incl. 1 DSC-class)
//   npx ts-node --transpile-only scripts/alt-backfill.ts --run         (full pass, day-resumable)
//   npx ts-node --transpile-only scripts/alt-backfill.ts --report      (audit, no writes)
import mongoose from "mongoose";
import sharp from "sharp";
import fs from "fs";
import path from "path";

const MODE = process.argv.includes("--calibrate") ? "calibrate" : process.argv.includes("--report") ? "report" : "run";
const CF_ACCOUNT = "3628c1c5cbbd3c8f629def153ed62562";
const CF_TOKEN = process.env.CF_API_TOKEN as string;
const MODEL = "@cf/llava-hf/llava-1.5-7b-hf";
const PROMPT = "Describe this image for a website photo gallery in one sentence of at most 15 words. Dense, factual, no preamble.";
const MEDIA_DIR = path.join(__dirname, "..", "media");
const PROGRESS = "/root/alt-progress.json";
const MAXW = 15;

function loadProgress(): Record<string, string> { try { return JSON.parse(fs.readFileSync(PROGRESS, "utf8")); } catch { return {}; } }
function saveProgress(p: Record<string, string>) { fs.writeFileSync(PROGRESS, JSON.stringify(p)); }

(async () => {
  const uri = process.env.DATABASE_URI;
  if (!uri) throw new Error("DATABASE_URI not set");
  await mongoose.connect(uri);
  const Media = mongoose.connection.collection("media");

  const images: any[] = await Media.find({ mimeType: { $regex: /^image\// } }, { projection: { filename: 1, alt: 1, mimeType: 1 } }).toArray();
  // sharing counted over IMAGE docs only (spec pin); non-raster mimes skipped+logged
  const CAPTIONABLE = ["image/webp", "image/jpeg", "image/png", "image/gif"];
  const skippedMime: string[] = [];
  for (const d of images) if (!CAPTIONABLE.includes(d.mimeType)) skippedMime.push(`${d.filename}:${d.mimeType}`);
  const byAlt = new Map<string, number>();
  for (const d of images) { const a = (d.alt ?? "").trim(); if (a) byAlt.set(a, (byAlt.get(a) ?? 0) + 1); }
  const stamps = new Set(Array.from(byAlt.entries()).filter((e) => e[1] > 2).map((e) => e[0])); // byte-exact from DB (em dashes intact)
  const empty = (d: any) => !d.alt || !d.alt.trim();
  const targets = images.filter((d) => CAPTIONABLE.includes(d.mimeType) && (empty(d) || stamps.has(d.alt.trim())));
  const protectedDocs = images.filter((d) => CAPTIONABLE.includes(d.mimeType) && !empty(d) && !stamps.has(d.alt.trim()));
  const beforeDistinct = new Set(images.map((d) => (d.alt ?? "").trim()).filter(Boolean)).size;
  console.log(`images=${images.length} targets=${targets.length} (empty=${targets.filter(empty).length}, stamped=${targets.filter((d) => !empty(d)).length}) stamps=${stamps.size} protected=${protectedDocs.length} distinctBefore=${beforeDistinct} skippedMime=${skippedMime.length}`);
  if (skippedMime.length) console.log("SKIPPED_MIME", JSON.stringify(skippedMime));
  if (stamps.size) console.log("STAMPS", JSON.stringify(Array.from(stamps)));

  if (MODE === "report") {
    const done = loadProgress();
    const stillEmpty = images.filter((d) => CAPTIONABLE.includes(d.mimeType) && empty(d)).length;
    const regenerated = targets.filter((d) => done[d._id.toString()]);
    const overLen = Array.from(Object.values(done)).filter((a: any) => String(a).trim().split(/\s+/).length > MAXW);
    const afterDistinct = new Set(images.map((d) => done[d._id.toString()] ?? (d.alt ?? "").trim()).filter(Boolean)).size;
    const sharedAfter = Array.from(images.reduce((m: any, d: any) => { const a = (done[d._id.toString()] ?? d.alt ?? "").trim(); if (a) m.set(a, (m.get(a) ?? 0) + 1); return m; }, new Map<string, number>()) as Map<string, number>).filter((e: any) => e[1] > 2);
    console.log(JSON.stringify({ stillEmpty, regenerated: regenerated.length, overLen: overLen.length, distinctBefore: beforeDistinct, distinctAfter: afterDistinct, sharedOver2After: sharedAfter }, null, 1));
    process.exit(stillEmpty === 0 && overLen.length === 0 ? 0 : 1);
  }

  // calibrate: first 10 = 9 earliest targets + 1 DSC-class (mandatory, spec)
  let batch = targets;
  if (MODE === "calibrate") {
    const dsc = targets.filter((d) => /DSC_\d+/i.test(d.filename));
    if (!dsc.length) throw new Error("calibration requires a DSC-class original; none found");
    batch = [...targets.slice(0, 9), dsc[0]];
  }

  const done = loadProgress();
  const fallbacks: string[] = [];
  const latencies: number[] = [];
  let n = 0;
  for (const doc of batch) {
    if (done[doc._id.toString()]) continue;
    const src = path.join(MEDIA_DIR, doc.filename);
    if (!fs.existsSync(src)) { console.log(`MISSING FILE ${doc.filename}`); continue; }
    const t0 = Date.now();
    const buf = await sharp(src).rotate().resize({ width: 1024, withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
    let desc = "";
    for (let attempt = 1; attempt <= 2; attempt++) {
      const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT}/ai/run/${MODEL}`, {
        method: "POST", headers: { Authorization: `Bearer ${CF_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({ image: Array.from(buf), prompt: PROMPT }),
      });
      const j: any = await res.json();
      desc = String(j?.result?.description ?? "").replace(/\s+/g, " ").trim().replace(/^["']|["']$/g, "");
      if (desc && desc.split(" ").length <= MAXW) break;
      desc = desc.split(" ").slice(0, MAXW).join(" "); // hard cap anyway
    }
    const words = desc ? desc.split(" ").length : 0;
    if (!desc || words === 0) {
      desc = doc.filename.replace(/\.[a-z0+9]+$/i, "").replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim().split(" ").slice(0, MAXW).join(" ");
      fallbacks.push(doc.filename);
    }
    latencies.push(Date.now() - t0);
    await Media.updateOne({ _id: doc._id }, { $set: { alt: desc } });
    done[doc._id.toString()] = desc;
    saveProgress(done);
    n++;
    console.log(`[${n}/${batch.length}] ${doc.filename} (${buf.length}B payload) -> "${desc}" (${words}w, ${Date.now() - t0}ms)`);
    await new Promise((r) => setTimeout(r, 400));
  }
  const avg = latencies.reduce((a, b) => a + b, 0) / (latencies.length || 1);
  console.log(`DONE mode=${MODE} calls=${n} avgLatency=${(avg / 1000).toFixed(1)}s fallbacks=${fallbacks.length} ${fallbacks.length ? JSON.stringify(fallbacks) : ""}`);
  if (MODE === "run" && n === 0) { try { fs.unlinkSync(PROGRESS); console.log("progress file removed (complete)"); } catch {} }
  process.exit(0);
})();
