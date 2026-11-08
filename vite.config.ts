import { readFileSync } from 'node:fs';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

export default defineConfig({
  base: './',
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['favicon.svg', 'icons/*.png'],
      manifest: {
        name: 'Free GST Billing',
        short_name: 'GST Billing',
        description: 'Free, offline GST billing, inventory and accounting.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#f8fafc',
        theme_color: '#4f46e5',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
        globIgnores: ['ocr/**'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/ocr/'),
            handler: 'CacheFirst',
            options: { cacheName: 'ocr-assets', expiration: { maxEntries: 40 } },
          },
        ],
      },
    }),
  ],
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: { '/api': { target: 'http://127.0.0.1:47371', changeOrigin: true } },
  },
  // No proxy here: preview must behave like static hosting (browser storage) and never
  // reach a real server.js that may be running on 47371 with the user's own data.
  preview: { host: '127.0.0.1', port: 4173, strictPort: true, proxy: {} },
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 2500 },
});
