import { defineConfig } from 'vite';

// Bundles server/index.ts (Express API + static host) and its dependencies (express, zod)
// into one file, dist-server/server.mjs, so a release ZIP runs with Node.js alone.
export default defineConfig({
  ssr: { noExternal: true },
  build: {
    ssr: 'server/index.ts',
    outDir: 'dist-server',
    emptyOutDir: true,
    target: 'node20',
    rollupOptions: { output: { entryFileNames: 'server.mjs', format: 'es' } },
  },
});
