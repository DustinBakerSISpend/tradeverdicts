// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://tradeverdicts.com',
  trailingSlash: 'always',
  integrations: [sitemap()],
  server: {
    port: 4322
  }
});
