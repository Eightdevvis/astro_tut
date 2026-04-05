// @ts-check
import { defineConfig } from 'astro/config';
import preact from "@astrojs/preact";
import vercel from "@astrojs/vercel";

// Canonical site URL: auf Vercel kommt VERCEL_URL (nur Hostname). Optional SITE_URL in
// Projekteinstellungen setzen, wenn du eine eigene Domain nutzt.
const site =
  process.env.SITE_URL ??
  (process.env.VERCEL && process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'http://localhost:4321');

// https://astro.build/config
export default defineConfig({
  site,
  output: 'server',
  adapter: vercel(),
  integrations: [preact()]
});