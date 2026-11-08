import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app';
import { BackupStore } from './backups';
import { FileStore } from './fileStore';

// dist-server/server.mjs -> project root
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT) || 47371;
const dataDir = resolve(root, process.env.GST_DATA_DIR || '_system/data');
const backupDir = resolve(root, process.env.GST_BACKUP_DIR || '_system/backups');
const version = (JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string }).version;

const store = new FileStore(dataDir);
await store.init();
const backups = new BackupStore(backupDir);
await backups.init();

const dailyBackup = () =>
  backups.ensureDaily(() => store.snapshot()).catch((e: unknown) => console.error('[backup] daily backup failed:', e));
await dailyBackup();
setInterval(dailyBackup, 60 * 60 * 1000).unref();

function openBrowser(url: string): void {
  const [cmd, args] =
    process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  spawn(cmd as string, args as string[], { stdio: 'ignore', detached: true, windowsHide: true }).unref();
}

const app = createApp({ store, backups, staticDir: join(root, 'dist'), port, version });
// Bind to the loopback interface only: the app is never reachable from the network.
const server = app.listen(port, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${port}`;
  console.info(`Free GST Billing ${version} is running at ${url}`);
  console.info(`Data folder:   ${dataDir}`);
  console.info(`Backup folder: ${backupDir}`);
  if (process.argv.includes('--open')) openBrowser(url);
});

server.on('error', (e: NodeJS.ErrnoException) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`Port ${port} is already in use. The app may already be running: open http://127.0.0.1:${port}`);
  } else {
    console.error(e);
  }
  process.exit(1);
});

const shutdown = () => {
  server.close();
  void store.flush().finally(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
