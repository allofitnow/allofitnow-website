require("dotenv").config();
/* Issue #18 — Upload 7 designer thumbnails to Payload media collection.
 * Run from repo root: node backend/scripts/upload-thumbs.js
 * Outputs: backend/scripts/media-map.json
 */
const FormData = require("form-data");
const fs = require("fs");
const path = require("path");
const fetch = require("node-fetch");

const API = "http://192.168.30.245/api";
const ASSETS = path.join(__dirname, "..", "..", "frontend", "public", "assets");
const OUT = path.join(__dirname, "media-map.json");

const EMAIL = "howard.wong@anufutur.com";
const PASSWORD = process.env.PAYLOAD_ADMIN_PASSWORD;

const FILES = [
  "bad-bunny.webp",
  "good-charlote.webp",
  "martin-garrix.webp",
  "melanie-martinez.webp",
  "peso-pluma.webp",
  "rauw-alejandro.webp",
  "renee-rapp.webp",
];

async function main() {
  // 1. Login
  const loginRes = await fetch(`${API}/users/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!loginRes.ok) throw new Error(`Login failed: ${loginRes.status} ${await loginRes.text()}`);
  const { token } = await loginRes.json();
  const authHeaders = { Authorization: `JWT ${token}` };

  const map = {};

  for (const file of FILES) {
    const filePath = path.join(ASSETS, file);
    if (!fs.existsSync(filePath)) {
      console.error(`SKIP (missing): ${file}`);
      continue;
    }

    // 2a. Dedup check
    const existingRes = await fetch(
      `${API}/media?where[filename][equals]=${encodeURIComponent(file)}&limit=1`,
      { headers: authHeaders }
    );
    const existing = await existingRes.json();
    if (existing.totalDocs > 0) {
      map[file] = existing.docs[0].id;
      console.log(`EXISTS: ${file} -> ${map[file]}`);
      continue;
    }

    // 2b. Upload via multipart
    const form = new FormData();
    form.append("file", fs.createReadStream(filePath), { filename: file });
    form.append("alt", file);
    const uploadRes = await fetch(`${API}/media`, {
      method: "POST",
      headers: { ...authHeaders, ...form.getHeaders() },
      body: form,
    });
    if (!uploadRes.ok) throw new Error(`Upload ${file} failed: ${uploadRes.status} ${await uploadRes.text()}`);
    const doc = await uploadRes.json();
    map[file] = doc.doc.id || doc.id;
    console.log(`UPLOADED: ${file} -> ${map[file]}`);
  }

  fs.writeFileSync(OUT, JSON.stringify(map, null, 2));
  console.log(`\nWrote ${Object.keys(map).length} entries to ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
