import { defineConfig, devices } from '@playwright/test';

// On the Windows dev PC run with PLAYWRIGHT_CHANNEL=msedge (uses installed Edge).
const channel = process.env.PLAYWRIGHT_CHANNEL;
const browser = { ...devices['Desktop Chrome'], ...(channel ? { channel } : {}) };
// Separate port and a fresh data folder per run, so tests never touch a running copy of the app.
const port = Number(process.env.E2E_PORT) || 47391;
const runId = process.env.E2E_RUN_ID || String(Date.now());
process.env.E2E_RUN_ID = runId;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { trace: 'retain-on-failure', screenshot: 'only-on-failure', acceptDownloads: true },
  projects: [
    { name: 'server-mode', use: { ...browser, baseURL: `http://127.0.0.1:${port}` } },
    { name: 'browser-mode', use: { ...browser, baseURL: 'http://127.0.0.1:4173' } },
  ],
  webServer: [
    {
      command: 'node server.js',
      url: `http://127.0.0.1:${port}/api/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { PORT: String(port), GST_DATA_DIR: `test-results/e2e-data-${runId}`, GST_BACKUP_DIR: `test-results/e2e-backups-${runId}` },
    },
    {
      command: 'node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 4173 --strictPort',
      url: 'http://127.0.0.1:4173',
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
