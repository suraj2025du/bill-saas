import { randomBytes } from 'node:crypto';
import { open, rename, rm } from 'node:fs/promises';

/** Errors Windows raises when antivirus / indexers briefly lock a file. */
const RETRY_CODES = new Set(['EPERM', 'EBUSY', 'EACCES', 'ENOTEMPTY']);

export async function retry<T>(fn: () => Promise<T>, attempts = 6, delayMs = 40): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (!code || !RETRY_CODES.has(code) || i >= attempts - 1) throw e;
      await new Promise((r) => setTimeout(r, delayMs * (i + 1)));
    }
  }
}

/**
 * Write to a temp file, flush it to disk, then rename over the target, so a
 * crash or power cut leaves either the old file or the new one, never half.
 */
export async function writeFileAtomic(path: string, data: string): Promise<void> {
  const tmp = `${path}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  const fh = await open(tmp, 'w');
  try {
    await fh.writeFile(data, 'utf8');
    await fh.sync();
  } finally {
    await fh.close();
  }
  try {
    await retry(() => rename(tmp, path));
  } catch (e) {
    await rm(tmp, { force: true });
    throw e;
  }
}
