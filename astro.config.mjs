import { defineConfig } from 'astro/config';
export default defineConfig({
  site: 'https://surajdash-math.github.io',
  base: '/bibliotheca',
  trailingSlash: 'always',
  devToolbar: { enabled: false },
  vite: { cacheDir: '.cache/vite' },
  build: { inlineStylesheets: 'always' }
});
