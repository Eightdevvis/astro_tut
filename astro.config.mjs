// @ts-check
import { defineConfig } from 'astro/config';
import preact from "@astrojs/preact";
import vercel from "@astrojs/vercel";

// https://astro.build/config
export default defineConfig({
  site: "https://astrotutut.netlify.app",
  output: 'server',
  adapter: vercel(),
  integrations: [preact()]
});