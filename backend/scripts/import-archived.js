import fs from 'fs';
import path from 'path';

// Using fetch since we assume Node 18+ (Node 22 is available on .245)
const PAYLOAD_URL = process.env.PAYLOAD_URL || 'http://127.0.0.1:3000';
const ADMIN_EMAIL = process.env.PAYLOAD_ADMIN_EMAIL || 'howard.wong@anufutur.com';
const ADMIN_PASSWORD = process.env.PAYLOAD_ADMIN_PASSWORD || 'Aoin2026!'; // Matches seed-projects.js

async function run() {
  console.log(`Using API URL: ${PAYLOAD_URL}`);

  // 1. Read Semplice export
  const exportPath = '/tmp/semplice-export/projects-v2.json';
  if (!fs.existsSync(exportPath)) {
    console.error(`Semplice export not found at ${exportPath}`);
    process.exit(1);
  }
  const rawData = fs.readFileSync(exportPath, 'utf8');
  const items = JSON.parse(rawData).projects;
  console.log(`Loaded ${items.length} legacy portfolios from export.`);

  // 2. Login to Payload
  const loginRes = await fetch(`${PAYLOAD_URL}/api/users/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  
  if (!loginRes.ok) {
    console.error('Login failed', await loginRes.text());
    process.exit(1);
  }
  const { token } = await loginRes.json();
  console.log('Logged in successfully.');

  // 3. Get placeholder media ID
  const mediaRes = await fetch(`${PAYLOAD_URL}/api/media?limit=1`, {
    headers: { Authorization: `JWT ${token}` },
  });
  const mediaData = await mediaRes.json();
  if (!mediaData.docs || mediaData.docs.length === 0) {
    console.error('No media found in Payload. A placeholder image is required for thumb/hero.');
    process.exit(1);
  }
  const PLACEHOLDER_MEDIA_ID = mediaData.docs[0].id;
  console.log(`Using media ID ${PLACEHOLDER_MEDIA_ID} as placeholder for missing thumbnails.`);

  // 4. Transform and POST
  let successCount = 0;
  let failCount = 0;
  let orderCounter = 8; // Existing projects are 1-7

  const capabilitiesMap = {
    'REAL-TIME CONTENT': 'REAL-TIME CONTENT',
    'SCREENS PRODUCTION': 'SCREENS PRODUCTION',
    'MIXED REALITY': 'MIXED REALITY',
    'EQUIPMENT RENTAL': 'EQUIPMENT RENTAL',
  };

  for (const item of items) {
    // Semplice meta maps to our taxonomy
    const projectTypeRaw = item.settings?.meta?.project_type?.toUpperCase() || '';
    const role = capabilitiesMap[projectTypeRaw] || 'REAL-TIME CONTENT';
    
    // Check for Vimeo background video
    let video_url = '';
    if (item.bg_video_url && item.bg_video_url.includes('vimeo')) {
      video_url = item.bg_video_url;
    }

    const payloadDoc = {
      title: item.title,
      slug: item.slug,
      client: item.client || item.title,
      year: item.year || '',
      role: role,
      code: 'TEMP', // Let beforeChange hook handle this
      status: 'archive', // Explicitly archiving
      order: orderCounter++,
      thumb: PLACEHOLDER_MEDIA_ID,
      hero: PLACEHOLDER_MEDIA_ID,
      capabilities: ['REAL-TIME CONTENT'], // Default since Semplice didn't have this
      scope: 'ARCHIVE', // Placeholder
    };

    if (video_url) {
      payloadDoc.video_url = video_url;
    }

    console.log(`POSTing ${payloadDoc.title}...`);
    const postRes = await fetch(`${PAYLOAD_URL}/api/projects`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `JWT ${token}`,
      },
      body: JSON.stringify(payloadDoc),
    });

    if (postRes.ok) {
      console.log(`✓ Success`);
      successCount++;
    } else {
      console.error(`✗ Failed`, await postRes.text());
      failCount++;
    }
  }

  console.log(`\nImport complete. Success: ${successCount}, Failed: ${failCount}`);
}

run().catch(console.error);