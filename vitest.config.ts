import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Coverage gate (>= 80% lines/branches/functions/statements) applies to the
// pure domain layer (src/core), the storage layer (src/data) and the local
// server. React screens are covered by the Playwright E2E suite instead.
export default defineConfig({
  plugins: [react()],
  test: {
    include: ['tests/unit/**/*.test.{ts,tsx}', 'tests/integration/**/*.test.{ts,tsx}'],
    environment: 'node',
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      include: ['src/core/**/*.ts', 'src/data/**/*.ts', 'server/**/*.ts'],
      exclude: ['**/*.d.ts', 'server/index.ts', 'src/core/model.ts'],
      thresholds: { lines: 80, branches: 80, functions: 80, statements: 80 },
      reporter: ['text-summary', 'json-summary', 'html'],
    },
  },
});
