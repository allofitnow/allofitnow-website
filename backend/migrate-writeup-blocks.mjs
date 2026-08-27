#!/usr/bin/env node
//
// Slate `writeup` -> block `writeupBlocks`.
//
// DRY RUN BY DEFAULT. Nothing is written without `--apply`, and even then only
// `writeupBlocks` is sent: `writeup` is left exactly as it is, so the migration
// is reversible by clearing the new field. A partial update also leaves
// `data.title` unset, which makes the collection's beforeChange hook return
// early and keeps the generated project code alone.
//
//   node backend/migrate-writeup-blocks.mjs                 # report only
//   node backend/migrate-writeup-blocks.mjs --verbose       # + per-block preview
//   node backend/migrate-writeup-blocks.mjs --slug bad-bunny
//   node backend/migrate-writeup-blocks.mjs --apply         # writes (asks for creds)
//
// Credentials for --apply come from PAYLOAD_ADMIN_EMAIL / PAYLOAD_ADMIN_PASSWORD.

const API = (process.env.PAYLOAD_URL || 'http://192.168.30.245').replace(/\/$/, '');
const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const VERBOSE = args.includes('--verbose');
const ONLY = (() => { const i = args.indexOf('--slug'); return i >= 0 ? args[i + 1] : null; })();

// ---------------------------------------------------------------- inline
// Slate leaves -> Markdown. Mirrors the grammar the copy-doc parser produces,
// so text that came in as `**bold**` goes back out the same way.
const escapeMd = (s) => String(s).replace(/([\\`*_[\]])/g, '\\$1');

function inline(nodes) {
  return (nodes || [])
    .map((n) => {
      if (n && n.type === 'link') return `[${inline(n.children)}](${n.url || ''})`;
      let t = escapeMd(n?.text ?? '');
      if (!t) return '';
      if (n.bold && n.italic) t = `***${t}***`;
      else if (n.bold) t = `**${t}**`;
      else if (n.italic) t = `*${t}*`;
      if (n.underline) t = `<u>${t}</u>`;
      if (n.code) t = `\`${t}\``;
      return t;
    })
    .join('');
}

const listMd = (node) =>
  (node.children || [])
    .map((li, i) => `${node.type === 'ol' ? `${i + 1}.` : '-'} ${inline(li?.children)}`)
    .join('\n');

// ---------------------------------------------------------------- blocks
/** One Slate node -> one block, or null with a reason recorded. */
function toBlock(node, unmapped) {
  if (!node || typeof node !== 'object') return null;
  const type = node.type;

  if (type === 'upload') {
    // The one shape the text form genuinely cannot hold — and the whole reason
    // this migration is worth doing. `fields` carries span/caption when the
    // editor set them in the Payload admin.
    const id = node.value?.id || node.value;
    if (!id) { unmapped.push('upload with no media id'); return null; }
    return {
      kind: 'media',
      media: id,
      span: node.fields?.span === 'half' ? 'half' : 'full',
      caption: node.fields?.caption || '',
    };
  }

  const heading = /^h([1-6])$/.exec(type || '');
  if (heading) {
    const text = inline(node.children).trim();
    if (!text) return null;
    // h1 and h4+ collapse onto the two levels the panel actually renders.
    return { kind: 'heading', level: Number(heading[1]) <= 2 ? '2' : '3', text };
  }

  if (type === 'ul' || type === 'ol') {
    const text = listMd(node).trim();
    return text ? { kind: 'text', text } : null;
  }

  if (type === 'blockquote') {
    const text = inline(node.children).trim();
    return text ? { kind: 'text', text: `> ${text}` } : null;
  }

  if (type && type !== 'paragraph') {
    unmapped.push(type);
    return null;
  }

  const text = inline(node.children).trim();
  return text ? { kind: 'text', text } : null;
}

function convert(writeup) {
  const unmapped = [];
  const blocks = [];
  for (const node of Array.isArray(writeup) ? writeup : []) {
    const b = toBlock(node, unmapped);
    if (b) blocks.push(b);
  }
  return { blocks, unmapped };
}

/** Plain text of a Slate value and of a block run, for a content-loss check. */
const slateText = (v) => (Array.isArray(v) ? v : []).map((n) => nodeText(n)).join(' ');
function nodeText(n) {
  if (!n || typeof n !== 'object') return '';
  if (n.type === 'upload') return '';
  if (typeof n.text === 'string') return n.text;
  return (n.children || []).map(nodeText).join('');
}
const blockText = (bs) => bs.filter((b) => b.kind !== 'media').map((b) => b.text).join(' ');
// Markdown syntax and whitespace differ; compare the letters and digits only.
const letters = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');

// ---------------------------------------------------------------- run
async function login() {
  const email = process.env.PAYLOAD_ADMIN_EMAIL;
  const password = process.env.PAYLOAD_ADMIN_PASSWORD;
  if (!email || !password) {
    throw new Error('--apply needs PAYLOAD_ADMIN_EMAIL and PAYLOAD_ADMIN_PASSWORD in the environment');
  }
  const res = await fetch(`${API}/api/users/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`login failed: ${res.status} ${await res.text()}`);
  return (await res.json()).token;
}

const main = async () => {
  const res = await fetch(`${API}/api/projects?limit=500&depth=0`);
  if (!res.ok) throw new Error(`could not read projects: ${res.status}`);
  let docs = (await res.json()).docs || [];
  if (ONLY) docs = docs.filter((d) => d.slug === ONLY);

  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} — ${API} — ${docs.length} project(s)\n`);

  const totals = { text: 0, heading: 0, media: 0 };
  const lossy = [];
  const unmappedAll = [];
  const already = [];
  const skipped = [];
  const todo = [];

  for (const d of docs) {
    if (Array.isArray(d.writeupBlocks) && d.writeupBlocks.length) { already.push(d.slug); continue; }
    if (!Array.isArray(d.writeup) || !d.writeup.length) continue;

    const { blocks, unmapped } = convert(d.writeup);
    const counts = blocks.reduce((a, b) => ((a[b.kind] = (a[b.kind] || 0) + 1), a), {});
    for (const k of Object.keys(totals)) totals[k] += counts[k] || 0;
    if (unmapped.length) unmappedAll.push(`${d.slug}: ${unmapped.join(', ')}`);

    // Every letter of prose in must be a letter of prose out.
    const before = letters(slateText(d.writeup));
    const after = letters(blockText(blocks));
    const ok = before === after;
    if (!ok) lossy.push({ slug: d.slug, beforeLen: before.length, afterLen: after.length });

    // A project whose write-up is one blank paragraph converts to nothing, and
    // writing `[]` over nothing is not a migration -- it is a PATCH, and every
    // PATCH fires the collection's afterChange hook, which queues a FULL SITE
    // BUILD. 19 of the 39 are in that state, so skipping them halves the rebuild
    // storm this script sets off.
    if (!blocks.length) { skipped.push(d.slug); continue; }
    todo.push({ doc: d, blocks });
    const flag = ok ? '   ' : ' ! ';
    console.log(
      `${flag}${(d.status || '').padEnd(9)} ${d.slug.padEnd(34)} ` +
      `${String(d.writeup.length).padStart(3)} nodes -> ${String(blocks.length).padStart(3)} blocks  ` +
      `[${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ') || 'empty'}]`
    );
    if (VERBOSE) {
      for (const b of blocks) {
        const preview = b.kind === 'media' ? `media ${b.media} (${b.span})` : b.text.replace(/\s+/g, ' ').slice(0, 96);
        console.log(`        ${b.kind === 'heading' ? `h${b.level}` : b.kind.padEnd(5)} | ${preview}`);
      }
    }
  }

  console.log(`\n${'-'.repeat(72)}`);
  console.log('would write   :', todo.length, 'project(s)');
  console.log('already block :', already.length, already.length ? `(${already.join(', ')})` : '');
  console.log('skipped, blank:', skipped.length, '(one empty paragraph — nothing to migrate)');
  console.log('blocks by kind:', totals);
  console.log('unmapped nodes:', unmappedAll.length ? unmappedAll : 'none');
  console.log('PROSE MISMATCH:', lossy.length ? lossy : 'none — every letter accounted for');

  if (!APPLY) {
    console.log('\nDry run. Nothing was written. Re-run with --apply to write `writeupBlocks`.');
    console.log('`writeup` is never modified, so this stays reversible.');
    return;
  }
  if (lossy.length) {
    console.log('\nREFUSING TO APPLY — prose mismatch above. Investigate before writing.');
    process.exitCode = 1;
    return;
  }

  // Each PATCH queues a site build through the collection's afterChange hook.
  console.log(`\nApplying to ${todo.length} project(s). Each one queues a site build.\n`);
  const token = await login();
  for (const { doc, blocks } of todo) {
    const r = await fetch(`${API}/api/projects/${doc.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `JWT ${token}` },
      body: JSON.stringify({ writeupBlocks: blocks }),
    });
    console.log(r.ok ? `wrote ${doc.slug}` : `FAILED ${doc.slug}: ${r.status} ${await r.text()}`);
  }
};

main().catch((e) => { console.error(e.message); process.exitCode = 1; });
