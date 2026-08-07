// @ts-check
import { defineConfig } from 'astro/config';
import node from '@astrojs/node';

// https://astro.build/config
export default defineConfig({
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
});
