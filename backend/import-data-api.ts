import fs from "fs";
import path from "path";
import FormData from "form-data";
import fetch from "node-fetch";

const API_URL = "http://localhost:3000/api";
const EMAIL = "howard.wong@anufutur.com";
const PASSWORD = process.env.PAYLOAD_ADMIN_PASSWORD;

async function login() {
  const res = await fetch(`${API_URL}/users/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD })
  });
  const data = await res.json();
  return data.token;
}

async function uploadMedia(token, url) {
  if (!url || !url.includes("/wp-content/uploads/")) return null;
  const relPath = url.split("/wp-content/uploads/")[1];
  const fullPath = path.join("/root/projects/allofitnow-media", relPath);
  
  if (!fs.existsSync(fullPath)) return null;
  const filename = path.basename(fullPath);

  // Check if exists
  const existRes = await fetch(`${API_URL}/media?where[filename][equals]=${filename}`, {
    headers: { "Authorization": `JWT ${token}` }
  });
  const existData = await existRes.json();
  if (existData.docs?.length > 0) return existData.docs?.[0].id;

  const form = new FormData();
  form.append("alt", filename);
  form.append("file", fs.createReadStream(fullPath));

  const res = await fetch(`${API_URL}/media`, {
    method: "POST",
    headers: { "Authorization": `JWT ${token}`, ...form.getHeaders() },
    body: form
  });
  const data = await res.json();
  return data.doc?.id;
}

const validCaps = ["REAL-TIME CONTENT", "SCREENS PRODUCTION", "MIXED REALITY", "EQUIPMENT RENTAL"];

async function run() {
  console.log("Logging in...");
  const token = await login();
  if (!token) throw new Error("Failed to login");

  const dataFile = "/root/projects/allofitnow-media/projects-export.json";
  const data = JSON.parse(fs.readFileSync(dataFile, "utf8"));

  // Make a dummy file
  fs.writeFileSync("/tmp/dummy.png", "dummy content");
  const form = new FormData();
  form.append("alt", "dummy.png");
  form.append("file", fs.createReadStream("/tmp/dummy.png"));
  const dRes = await fetch(`${API_URL}/media`, {
    method: "POST",
    headers: { "Authorization": `JWT ${token}`, ...form.getHeaders() },
    body: form
  });
  const dData = await dRes.json();
  const dummyId = dData.doc?.id || (await (await fetch(`${API_URL}/media?where[filename][equals]=dummy.png`)).json()).docs?.[0]?.id;

  for (const p of data.projects) {
    console.log(`Importing: ${p.title}`);
    let thumbId = await uploadMedia(token, p.thumb?.url) || dummyId;
    let heroUrl = p.hero?.image_url || p.hero?.video_url || p.hero?.fallback_url;
    let heroId = await uploadMedia(token, heroUrl) || dummyId;

    let role = p.role && validCaps.includes(p.role) ? p.role : "REAL-TIME CONTENT";
    let caps = (p.capabilities || []).filter(c => validCaps.includes(c));
    if (caps.length === 0) caps = ["REAL-TIME CONTENT"];

    const projectData = {
      title: p.title || "Untitled",
      slug: p.slug || p.title.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      code: "TEMP",
      client: p.client || "All of it Now",
      year: String(p.year || "2024"),
      role,
      scope: p.scope || "Full Service",
      order: p.order || 99,
      thumb: thumbId,
      hero: heroId,
      body: p.body_html || "No body content",
      capabilities: caps,
      tour: p.tour || "",
      collaborator: p.collaborator || "",
      summary: p.summary || p.body_html?.substring(0, 150) || "Summary",
      gallery: [],
      stats: [],
      credits: [],
      writeup: { lead: "", body: [] }
    };

    const exRes = await fetch(`${API_URL}/projects?where[slug][equals]=${projectData.slug}`, {
      headers: { "Authorization": `JWT ${token}` }
    });
    const exData = await exRes.json();

    if (exData.docs?.length > 0) {
      await fetch(`${API_URL}/projects/${exData.docs?.[0].id}`, {
        method: "PATCH",
        headers: { "Authorization": `JWT ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(projectData)
      });
      console.log(`  Updated ${p.title}`);
    } else {
      await fetch(`${API_URL}/projects`, {
        method: "POST",
        headers: { "Authorization": `JWT ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(projectData)
      });
      console.log(`  Created ${p.title}`);
    }
  }
  console.log("Done");
}
run();