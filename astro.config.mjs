// @ts-check
import { defineConfig } from 'astro/config';
import { fileURLToPath } from 'node:url';
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
  integrations: [preact()],
  vite: {
    // Ketcher zieht Node-Polyfills wie `util` rein, die `process.env.NODE_DEBUG`
    // & Co. erwarten. Im Build replacet Vite `process.env.NODE_ENV` automatisch;
    // im Dev-Server muss `process` als Browser-Stub explizit existieren, sonst
    // crashes mit `ReferenceError: process is not defined` aus chunk-YZF324B4.
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development'),
      'process.platform': '"browser"',
      'process.version': '"v22.0.0"',
      'process.env': '{}',
      global: 'globalThis',
    },
    optimizeDeps: {
      esbuildOptions: {
        define: {
          'process.env.NODE_ENV': '"development"',
          'process.platform': '"browser"',
          'process.version': '"v22.0.0"',
          global: 'globalThis',
        },
      },
    },
    resolve: {
      // Ketcher (und andere reine React-Bibs) importieren intern aus 'react' /
      // 'react-dom'. Wir aliasen auf preact/compat, damit Hooks und Renderer
      // im selben Tree wie unsere Preact-Inseln laufen — sonst kracht es beim
      // Mounten mit "Cannot read properties of null (reading 'useState')".
      alias: {
        'react/jsx-runtime': 'preact/jsx-runtime',
        'react/jsx-dev-runtime': 'preact/jsx-runtime',
        // createRoot/hydrateRoot fehlen in preact/compat — eigener Shim noetig.
        'react-dom/client': fileURLToPath(
          new URL('./src/lib/preact-react-dom-client-shim.js', import.meta.url),
        ),
        'react-dom/test-utils': 'preact/test-utils',
        'react-dom': 'preact/compat',
        react: 'preact/compat',
      },
    },
    build: {
      chunkSizeWarningLimit: 550,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) return;
            if (id.includes('/three/examples/')) return 'vendor-three-extras';
            if (id.includes('/three/src/renderers/')) return 'vendor-three-renderers';
            if (id.includes('/three/src/math/') || id.includes('/three/src/core/')) {
              return 'vendor-three-core';
            }
            if (id.includes('/three/')) return 'vendor-three-misc';
            if (id.includes('/html2canvas/')) return 'vendor-html2canvas';
            if (id.includes('/katex/')) return 'vendor-katex';
          },
        },
      },
    },
  },
});