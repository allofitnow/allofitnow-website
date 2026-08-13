require("dotenv").config();
/* Issue #19 — Seed 7 projects into Payload from designer data.
 * Run from backend/: node scripts/seed-projects.js
 * Prereqs: #17 (public read), #18 (media-map.json exists)
 */
const fs = require("fs");
const path = require("path");
const fetch = require("node-fetch");

const API = "http://192.168.30.245/api";
const MEDIA_MAP = JSON.parse(fs.readFileSync(path.join(__dirname, "media-map.json"), "utf8"));
const EMAIL = "howard.wong@anufutur.com";
const PASSWORD = process.env.PAYLOAD_ADMIN_PASSWORD;

/* ---------------- Shared values (identical across all 7) ---------------- */
const SUMMARY =
  "A touring show built on real-time content — generative systems cut to the music and driven live at full show resolution, engineered to hold up night after night on a moving schedule.";

const STATS = [
  { label: "LED SURFACE", value: "1,240m²" },
  { label: "SHOWS", value: "38" },
  { label: "PIXEL PITCH", value: "3.9mm" },
  { label: "RUNTIME", value: "2H 15M" },
];

// Each entry: title (role) | name (display) — name links to the social `url`.
const CREDITS = [
  {
    title: "ALL OF IT NOW",
    entries: [
      { title: "CREATIVE DIRECTION", name: "ALL OF IT NOW", url: "https://instagram.com/allofitnow" },
      { title: "CONTENT LEAD", name: "AOIN REALTIME", url: "https://instagram.com/aoin.realtime" },
      { title: "SYSTEMS ENGINEER", name: "AOIN SYSTEMS", url: "https://instagram.com/aoin.systems" },
      { title: "PRODUCER", name: "AOIN PROD", url: "https://instagram.com/aoin.prod" },
    ],
  },
  {
    title: "COLLABORATORS",
    entries: [
      { title: "PRODUCTION DESIGN", name: "STURDY.CO", url: "https://instagram.com/sturdy.co" },
      { title: "CREATIVE STUDIO", name: "PHNTM", url: "https://instagram.com/phntm" },
      { title: "LIGHTING DESIGN", name: "LD STUDIO", url: "https://instagram.com/ld.studio" },
    ],
  },
];

const WRITEUP_BODY_PARAGRAPHS = [
  "The brief was a stage that could change character between songs without a hard cut — so the content had to be generative rather than baked, reacting to timecode and to the band on stage instead of running as a fixed film.",
  "We built the look as a set of real-time systems in a single scene graph: camera-aware grading, particle fields tied to the low end, and a set of LED-native transitions that never resolve to a seam. Playback ran redundant, with a warm spare tracking the show frame-for-frame.",
  "Everything was authored to survive the tour: one operator, a fixed I/O map, and content that degrades gracefully if a panel drops rather than tearing the whole surface.",
];

/* ---------------- Per-project unique values ---------------- */
const PROJECTS = [
  { slug: "bad-bunny", title: "BAD BUNNY", year: "2024", order: 1, capabilities: ["REAL-TIME CONTENT", "SCREENS PRODUCTION"], tour: "WORLD TOUR", collaborator: "ALL OF IT NOW X PHNTM", lead: "BAD BUNNY needed content that could carry a full arena show and still feel live — not a video playing behind the artist, but a stage that responds in the moment.", thumb: "bad-bunny.webp" },
  { slug: "rauw-alejandro", title: "RAUW ALEJANDRO", year: "2024", order: 2, capabilities: ["SCREENS PRODUCTION", "MIXED REALITY"], tour: "SATURNO TOUR", collaborator: "ALL OF IT NOW X STURDY.CO", lead: "RAUW ALEJANDRO needed content that could carry a full arena show and still feel live — not a video playing behind the artist, but a stage that responds in the moment.", thumb: "rauw-alejandro.webp" },
  { slug: "martin-garrix", title: "MARTIN GARRIX", year: "2023", order: 3, capabilities: ["REAL-TIME CONTENT", "MIXED REALITY"], tour: "FESTIVAL RUN", collaborator: "ALL OF IT NOW X STURDY.CO", lead: "MARTIN GARRIX needed content that could carry a full arena show and still feel live — not a video playing behind the artist, but a stage that responds in the moment.", thumb: "martin-garrix.webp" },
  { slug: "peso-pluma", title: "PESO PLUMA", year: "2024", order: 4, capabilities: ["SCREENS PRODUCTION", "EQUIPMENT RENTAL"], tour: "ARENA TOUR", collaborator: "ALL OF IT NOW X STURDY.CO", lead: "PESO PLUMA needed content that could carry a full arena show and still feel live — not a video playing behind the artist, but a stage that responds in the moment.", thumb: "peso-pluma.webp" },
  { slug: "melanie-martinez", title: "MELANIE MARTINEZ", year: "2023", order: 5, capabilities: ["MIXED REALITY", "REAL-TIME CONTENT"], tour: "TRILOGY TOUR", collaborator: "ALL OF IT NOW X PHNTM", lead: "MELANIE MARTINEZ needed content that could carry a full arena show and still feel live — not a video playing behind the artist, but a stage that responds in the moment.", thumb: "melanie-martinez.webp" },
  { slug: "good-charlotte", title: "GOOD CHARLOTTE", year: "2022", order: 6, capabilities: ["REAL-TIME CONTENT", "EQUIPMENT RENTAL"], tour: "GENERATION RX", collaborator: "ALL OF IT NOW X PHNTM", lead: "GOOD CHARLOTTE needed content that could carry a full arena show and still feel live — not a video playing behind the artist, but a stage that responds in the moment.", thumb: "good-charlote.webp" },
  { slug: "renee-rapp", title: "RENÉE RAPP", year: "2024", order: 7, capabilities: ["REAL-TIME CONTENT", "SCREENS PRODUCTION"], tour: "THEATRE TOUR", collaborator: "ALL OF IT NOW X PHNTM", lead: "RENÉE RAPP needed content that could carry a full arena show and still feel live — not a video playing behind the artist, but a stage that responds in the moment.", thumb: "renee-rapp.webp" },
];

const ALL_STILLS = PROJECTS.map((p) => p.thumb); // 7 filenames, indexed by project order

function buildGallery(projectIndex) {
  const gallery = [];
  for (let k = 0; k < 6; k++) {
    const filename = ALL_STILLS[(projectIndex + k) % 7];
    gallery.push({ image: MEDIA_MAP[filename] });
  }
  return gallery;
}

function buildProject(p, index) {
  return {
    title: p.title,
    slug: p.slug,
    code: "TEMP", // beforeChange hook overwrites
    year: p.year,
    order: p.order,
    // Single key image, used as both the work-list thumbnail and the hero.
    image: MEDIA_MAP[p.thumb],
    capabilities: p.capabilities,
    tour: p.tour,
    collaborator: p.collaborator,
    summary: SUMMARY,
    gallery: buildGallery(index),
    stats: STATS,
    credits: CREDITS,
    // Rich text (Slate): lede paragraph followed by the body paragraphs.
    writeup: [
      { children: [{ text: p.lead }] },
      ...WRITEUP_BODY_PARAGRAPHS.map((text) => ({ children: [{ text }] })),
    ],
  };
}

async function main() {
  // 1. Login
  const loginRes = await fetch(`${API}/users/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!loginRes.ok) throw new Error(`Login failed: ${loginRes.status} ${await loginRes.text()}`);
  const { token } = await loginRes.json();
  const authHeaders = { "Content-Type": "application/json", Authorization: `JWT ${token}` };

  // 2. Delete all existing projects (stale 22-doc import)
  const listRes = await fetch(`${API}/projects?limit=100`, { headers: authHeaders });
  const { docs } = await listRes.json();
  console.log(`Deleting ${docs.length} stale projects...`);
  for (const doc of docs) {
    const del = await fetch(`${API}/projects/${doc.id}`, { method: "DELETE", headers: authHeaders });
    if (!del.ok) console.warn(`  DELETE failed ${doc.id}: ${del.status}`);
  }
  console.log("Stale projects cleared.");

  // 3. POST each project
  for (let i = 0; i < PROJECTS.length; i++) {
    const p = PROJECTS[i];
    const body = buildProject(p, i);
    const res = await fetch(`${API}/projects`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.error(`POST ${p.slug} FAILED: ${res.status} ${await res.text()}`);
      continue;
    }
    const doc = await res.json();
    console.log(`CREATED: ${p.slug} (code=${doc.doc.code})`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
