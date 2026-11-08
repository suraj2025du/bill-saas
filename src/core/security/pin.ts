import { randomHex } from '../ids';
import type { PinHash } from '../model';

export const PIN_ITERATIONS = 150_000;

export function isValidPinFormat(pin: string): boolean {
  return /^\d{4,8}$/.test(pin);
}

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(hex.length / 2));
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function derive(pin: string, saltHex: string, iterations: number): Promise<string> {
  const subtle = globalThis.crypto.subtle;
  const key = await subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: hexToBytes(saltHex), iterations }, key, 256);
  return bytesToHex(new Uint8Array(bits));
}

/** Hash a PIN for storage. The PIN itself is never stored. */
export async function hashPin(pin: string, iterations = PIN_ITERATIONS): Promise<PinHash> {
  if (!isValidPinFormat(pin)) throw new Error('PIN must be 4 to 8 digits.');
  const salt = randomHex(16);
  return { hash: await derive(pin, salt, iterations), salt, iterations };
}

/** Constant-time comparison of the derived hash. */
export async function verifyPin(pin: string, stored: PinHash): Promise<boolean> {
  if (!isValidPinFormat(pin)) return false;
  const candidate = await derive(pin, stored.salt, stored.iterations);
  if (candidate.length !== stored.hash.length) return false;
  let diff = 0;
  for (let i = 0; i < candidate.length; i++) diff |= candidate.charCodeAt(i) ^ stored.hash.charCodeAt(i);
  return diff === 0;
}
