// @ts-check
import { defineConfig } from 'astro/config';
import node from '@astrojs/node';

// https://astro.build/config
export default defineConfig({
  // Canonical origin for og:url / canonical / sitemap. Staging builds default
  // to the R2 preview host; prod builds pass SITE_URL explicitly (#67).
  site: process.env.SITE_URL || 'https://46009.someofitlater.com',
  // Static by default; individual routes opt into on-demand rendering with
  // `export const prerender = false` once Payload is in the loop (phase 2).
  output: 'static',
  adapter: node({ mode: 'standalone' }),

  // The flight transition needs the destination already fetched before the
  // swap commits. Hover prefetch is a requirement here, not an optimisation.
  prefetch: {
    prefetchAll: true,
    defaultStrategy: 'hover',
  },

  vite: {
    server: {
      allowedHosts:['.tail5e27f.ts.net']
    }
  }
});
