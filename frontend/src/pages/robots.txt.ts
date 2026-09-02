import type { APIRoute } from 'astro';

// #67 AC9: real robots.txt served by the site (replaces the CF edge
// placeholder that appears when no object exists). Sitemap line follows
// Astro.site (SITE_URL build env) exactly like the canonical/og:url decision.
//
// #116 crawler policy: /api/ is off-limits to every agent (the contact
// endpoint is not a crawl surface). AI training scrapers (GPTBot, ClaudeBot,
// CCBot, Google-Extended, anthropic-ai) and harvesters/SEO backlink bots
// (EmailCollector, SemrushBot, AhrefsBot, DotBot) are excluded site-wide —
// proprietary portfolio content, zero SEO cost. Search engines untouched.
// Advisory only: actual abuse enforcement lives in the worker vet layers
// (#112 L1-L3), not here.
//
// The CF content-signals block is intentionally NOT inlined: if the
// account-level Content Signals feature is ever enabled it appends its own
// reservation text, and duplicating it here would render the file
// twice-over on the edge. The explicit UA blocks above are ours and
// independent of that feature.

const EXCLUDED = [
  // AI training scrapers
  'GPTBot',
  'ClaudeBot',
  'CCBot',
  'Google-Extended',
  'anthropic-ai',
  // Harvesters / SEO backlink bots
  'EmailCollector',
  'SemrushBot',
  'AhrefsBot',
  'DotBot',
];

export const GET: APIRoute = async ({ site }) => {
  const base = (site?.toString() ?? 'https://46009.someofitlater.com').replace(/\/$/, '');
  const blocks = EXCLUDED.map((ua) => `User-agent: ${ua}\nDisallow: /`).join('\n\n');
  const body = `# allofitnow.com crawler policy\n# Advisory. Enforcement lives at the edge/worker, not here.\n\nUser-agent: *\nDisallow: /api/\n\n# Excluded: AI training scrapers, harvesters, SEO backlink bots\n${blocks}\n\nSitemap: ${base}/sitemap.xml\n`;
  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
