import payload from "payload";
import config from "./payload.config";
import fs from "fs";
import path from "path";
import mime from "mime-types";

// Utility to download remote files (like Vimeo) or copy local files into Payload
async function uploadMedia(url) {
  if (!url) return null;
  
  // Local paths mapped from Lightsail uploads
  if (url.includes("/wp-content/uploads/")) {
    const relPath = url.split("/wp-content/uploads/")[1];
    const fullPath = path.join("/root/projects/allofitnow-media", relPath);
    
    if (!fs.existsSync(fullPath)) {
      console.warn("Local file not found:", fullPath);
      return null;
    }
    
    const ext = path.extname(fullPath);
    const filename = path.basename(fullPath);
    const mimeType = mime.lookup(ext) || "application/octet-stream";
    const size = fs.statSync(fullPath).size;
    
    try {
      // Check if it already exists
      const existing = await payload.find({
        collection: "media",
        where: { filename: { equals: filename } },
        limit: 1
      });
      
      if (existing.totalDocs > 0) return existing.docs[0].id;

      const media = await payload.create({
        collection: "media",
        data: { alt: filename },
        filePath: fullPath
      });
      return media.id;
    } catch (e) {
      console.error("Error uploading", filename, e.message);
      return null;
    }
  }
  
  return null;
}

// Ensure required capabilities
const validCaps = ["REAL-TIME CONTENT", "SCREENS PRODUCTION", "MIXED REALITY", "EQUIPMENT RENTAL"];
function mapCaps(caps) {
  if (!caps || !Array.isArray(caps)) return ["REAL-TIME CONTENT"];
  const mapped = caps.filter(c => validCaps.includes(c));
  return mapped.length > 0 ? mapped : ["REAL-TIME CONTENT"];
}

(async () => {
  await payload.init({
    secret: process.env.PAYLOAD_SECRET || "dev-secret",
    config: config as any,
    local: true,
  });

  const dataFile = "/root/projects/allofitnow-media/projects-export.json";
  const data = JSON.parse(fs.readFileSync(dataFile, "utf8"));
  
  // Dummy media for missing thumbs/heroes
  const dummyMediaId = await (async () => {
      const existing = await payload.find({ collection: "media", where: { filename: { equals: "dummy.png" } }, limit: 1 });
      if (existing.totalDocs > 0) return existing.docs[0].id;
      // create a dummy file
      fs.writeFileSync("/tmp/dummy.png", "dummy image content");
      const media = await payload.create({ collection: "media", data: { alt: "dummy" }, filePath: "/tmp/dummy.png" });
      return media.id;
  })();

  for (const p of data.projects) {
    console.log(`Importing: ${p.title}`);
    
    // Upload media
    let thumbId = await uploadMedia(p.thumb?.url) || dummyMediaId;
    let heroUrl = p.hero?.image_url || p.hero?.video_url || p.hero?.fallback_url;
    let heroId = await uploadMedia(heroUrl) || dummyMediaId;

    const role = p.role && validCaps.includes(p.role) ? p.role : "REAL-TIME CONTENT";
    
    // Check if project exists
    const existing = await payload.find({
      collection: "projects",
      where: { slug: { equals: p.slug } },
      limit: 1
    });

    const projectData = {
      title: p.title || "Untitled",
      slug: p.slug || p.title.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      code: "TEMP", // Will be auto-assigned by hook
      client: p.client || "All of it Now",
      year: String(p.year || "2024"),
      role: role,
      scope: p.scope || "Full Service",
      order: p.order || 99,
      thumb: thumbId,
      hero: heroId,
      body: p.body_html || "No body content",
      capabilities: mapCaps(p.capabilities),
      tour: p.tour || "",
      collaborator: p.collaborator || "",
      summary: p.summary || p.body_html?.substring(0, 150) || "Summary",
      gallery: [],
      stats: [],
      credits: [],
      writeup: {
        lead: "",
        body: []
      }
    };

    try {
      if (existing.totalDocs > 0) {
        await payload.update({
          collection: "projects",
          id: existing.docs[0].id,
          data: projectData
        });
        console.log(`  Updated ${p.title}`);
      } else {
        await payload.create({
          collection: "projects",
          data: projectData
        });
        console.log(`  Created ${p.title}`);
      }
    } catch (e) {
      console.error(`  Error on ${p.title}:`, e.message);
    }
  }

  console.log("Import complete!");
  process.exit(0);
})().catch(e => {
  console.error(e.message);
  process.exit(1);
});