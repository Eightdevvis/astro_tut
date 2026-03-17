// @ts-check
import { defineConfig } from 'astro/config';
import preact from "@astrojs/preact";
import node from "@astrojs/node";

// https://astro.build/config
export default defineConfig({
  site: "https://astrotutut.netlify.app",
  // SSR aktivieren damit API-Routen & Cookies funktionieren
  // 'server' = alles wird server-seitig gerendert (kein statisches HTML-Export)
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  integrations: [preact()]
});