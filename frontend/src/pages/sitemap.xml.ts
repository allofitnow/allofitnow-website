import type { APIRoute } from 'astro';
import { getRoutableProjects } from '@/data/projects';

// #67 AC7: XML sitemap covering all public routes. Static endpoint; the
// project roster comes from Payload at build time (same accessor the
// [slug] pages use), so the sitemap can never drift from the built pages.
// Origin follows Astro.site (SITE_URL build env, #67 canonical decision:
// staging build advertises 46009, prod build advertises the apex).

export const GET: APIRoute = async ({ site }) => {
  const base = (site?.toString() ?? 'https://46009.someofitlater.com').replace(/\/$/, '');
  const today = new Date().toISOString().slice(0, 10);

  let slugs: string[] = [];
  try {
    slugs = (await getRoutableProjects()).map((p) => p.slug);
  } catch {
    // Build-time Payload outage: ship the static routes only rather than
    // failing the whole build; the [slug] pages would fail louder anyway.
  }

  const routes: Array<[loc: string, priority: string]> = [
    ['/', '1.0'],
    ['/work', '0.9'],
    ['/services', '0.9'],
    ['/studio', '0.7'],
    ['/privacy', '0.3'],
    ...slugs.map((s) => [`/work/${s}`, '0.8'] as [string, string]),
  ];

  const urls = routes
    .map(
      ([loc, priority]) =>
        `  <url>\n    <loc>${base}${loc === '/' ? '/' : loc}</loc>\n    <lastmod>${today}</lastmod>\n    <priority>${priority}</priority>\n  </url>`,
    )
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;

  return new Response(xml, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
};
