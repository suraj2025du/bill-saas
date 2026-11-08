const HEX = '0123456789abcdef';

/** Cryptographically random hex string (uses getRandomValues, which works in every context). */
export function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(buf);
  let out = '';
  for (const b of buf) out += HEX[b >> 4]! + HEX[b & 15]!;
  return out;
}

/** New record id such as `inv_3f9a0c1d2e4b5a6978c0`. */
export function newId(prefix: string): string {
  return `${prefix}_${randomHex(10)}`;
}

/** Ids accepted by the storage layer and the server. */
export const ID_PATTERN = /^[A-Za-z0-9_.:-]{1,80}$/;

export function isValidId(id: unknown): id is string {
  return typeof id === 'string' && ID_PATTERN.test(id);
}

let lastNow = 0;

/**
 * Current time as ISO 8601. Never repeats within one tab, even for two saves in the same
 * millisecond, because a record's `updatedAt` is its version in the storage conflict check.
 */
export function nowISO(): string {
  lastNow = Math.max(Date.now(), lastNow + 1);
  return new Date(lastNow).toISOString();
}
