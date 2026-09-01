import type { APIRoute } from 'astro';

// #67 AC9: real robots.txt served by the site (replaces the CF edge
// placeholder that appears when no object exists). Permits all crawlers;
// Sitemap line follows Astro.site (SITE_URL build env) exactly like the
// canonical/og:url decision. The CF content-signals block is intentionally
// NOT inlined: the account-level Content Signals feature appends its own
// reservation text to robots.txt responses, and duplicating it here would
// render the file twice-over on the edge.

export const GET: APIRoute = async ({ site }) => {
  const base = (site?.toString() ?? 'https://46009.someofitlater.com').replace(/\/$/, '');
  const body = `User-agent: *\nAllow: /\n\nSitemap: ${base}/sitemap.xml\n`;
  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
