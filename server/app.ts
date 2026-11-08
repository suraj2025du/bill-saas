import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import { APP_ID } from '../src/core/model';
import { validateSnapshot } from '../src/core/schema';
import { MAX_REQUEST_BYTES, MAX_RESTORE_BYTES } from '../src/data/http';
import type { BackupStore } from './backups';
import type { FileStore } from './fileStore';
import { BadRequestError, validateBatch } from './fileStore';
import { apiGuard, hostGuard, securityHeaders } from './security';

export interface AppOptions {
  store: FileStore;
  backups: BackupStore;
  /** Built front-end (dist/). Omit to serve the API only. */
  staticDir?: string;
  port: number;
  version: string;
}

interface HttpishError {
  status?: number;
  statusCode?: number;
  type?: string;
  details?: string[];
  message?: string;
  /** Byte limit of a body that was too large. */
  limit?: number;
}

export function createApp(o: AppOptions): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(hostGuard(o.port));
  app.use(securityHeaders);

  const api = express.Router();
  api.use(apiGuard);
  // A restore upload is a whole backup file (photos of purchase bills included); everything else is one save.
  api.use('/restore', express.json({ limit: MAX_RESTORE_BYTES }));
  api.use(express.json({ limit: MAX_REQUEST_BYTES }));

  api.get('/health', (_req, res) => {
    res.json({ ok: true, app: APP_ID, version: o.version, mode: 'server', dataDir: o.store.dir, backupDir: o.backups.dir });
  });

  api.get('/db', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ collections: o.store.getAll() });
  });

  api.post('/commit', async (req, res) => {
    const batch = validateBatch(req.body);
    await o.store.commit(batch);
    res.status(204).end();
  });

  /** Check a backup fully, keep a pre-restore backup of the current data, then replace everything. */
  const restore = async (input: unknown) => {
    const v = validateSnapshot(input);
    if (!v.ok) throw new BadRequestError('The backup failed the integrity check; your current data was not changed.', v.errors);
    await o.backups.create(o.store.snapshot(), 'pre-restore');
    await o.store.replaceAll(v.snapshot);
  };

  api.post('/restore', async (req, res) => {
    await restore(req.body);
    res.status(204).end();
  });

  api.get('/backups', async (_req, res) => {
    res.json(await o.backups.list());
  });

  api.post('/backups', async (req, res) => {
    const reason = (req.body as { reason?: string } | undefined)?.reason === 'auto' ? 'auto' : 'manual';
    res.status(201).json(await o.backups.create(o.store.snapshot(), reason));
  });

  api.get('/backups/:id', async (req, res) => {
    res.json(await o.backups.read(String(req.params.id)));
  });

  // Restores a backup in the backup folder without sending it to the browser and back (review Y11).
  api.post('/backups/:id/restore', async (req, res) => {
    await restore(await o.backups.read(String(req.params.id)));
    res.status(204).end();
  });

  api.use((_req, res) => {
    res.status(404).json({ error: 'Not found.' });
  });

  api.use((err: HttpishError, _req: Request, res: Response, next: NextFunction) => {
    void next;
    const status = err.status ?? err.statusCode ?? 500;
    if (status >= 500) {
      console.error('[api]', err);
      res.status(500).json({ error: 'The server could not complete the request. Your last saved data is safe.' });
      return;
    }
    const message =
      err.type === 'entity.parse.failed'
        ? 'Request body is not valid JSON.'
        : err.type === 'entity.too.large'
          ? `Request is too large (limit ${Math.round((err.limit ?? MAX_REQUEST_BYTES) / 1_048_576)} MB).`
          : (err.message ?? 'Bad request.');
    res.status(status).json({ error: message, details: err.details ?? [] });
  });

  app.use('/api', api);

  if (o.staticDir) {
    app.use(
      express.static(o.staticDir, {
        index: 'index.html',
        setHeaders(res, path) {
          const immutable = /[\\/]assets[\\/]/.test(path);
          res.setHeader('Cache-Control', immutable ? 'public, max-age=31536000, immutable' : 'no-cache');
        },
      }),
    );
  }

  app.use((_req, res) => {
    res.status(404).type('text/plain').send('Not found');
  });
  return app;
}
