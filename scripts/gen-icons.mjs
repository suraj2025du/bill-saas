// Writes the PWA icons (public/icons/*.png) with no image tools installed:
// the shapes of public/favicon.svg are rasterised in plain JavaScript and
// encoded as PNG with node:zlib. Run with `npm run icons`.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
mkdirSync(out, { recursive: true });

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function png(size, rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
/** Signed distance to a rounded rectangle (negative inside). */
function roundRect(px, py, x, y, w, h, r) {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const qx = Math.abs(px - cx) - (w / 2 - r);
  const qy = Math.abs(py - cy) - (h / 2 - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

function draw(size, maskable) {
  const s = size / 64;
  // Maskable icons keep the artwork inside the central 80% safe zone.
  const k = maskable ? 0.72 : 1;
  const off = (64 - 64 * k) / 2;
  const T = (v) => (off + v * k) * s;
  const shapes = [
    { color: '#4f46e5', fn: (x, y) => (maskable ? -1 : roundRect(x, y, 0, 0, size, size, 14 * s)) },
    // document body with a folded corner
    // Same path as the SVG: the top-right corner above the line (39,12)-(47,20) is cut away...
    { color: '#ffffff', fn: (x, y) => Math.max(roundRect(x, y, T(17), T(12), T(47) - T(17), T(54) - T(12), 2 * s * k), x - T(39) > y - T(12) && y < T(20) ? 1 : -1) },
    // ...and the fold is the triangle (39,12) (39,20) (47,20).
    { color: '#c7d2fe', fn: (x, y) => (x >= T(39) && y >= T(12) && y <= T(20) && x - T(39) <= y - T(12) ? -1 : 1) },
    { color: '#4f46e5', fn: (x, y) => roundRect(x, y, T(22), T(26), 18 * s * k, 3 * s * k, 1.5 * s * k) },
    { color: '#a5b4fc', fn: (x, y) => roundRect(x, y, T(22), T(33), 20 * s * k, 3 * s * k, 1.5 * s * k) },
    { color: '#a5b4fc', fn: (x, y) => roundRect(x, y, T(22), T(40), 12 * s * k, 3 * s * k, 1.5 * s * k) },
    { color: '#10b981', fn: (x, y) => roundRect(x, y, T(34), T(44), 10 * s * k, 5 * s * k, 2.5 * s * k) },
  ];
  const buf = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (const shape of shapes) {
        // 4x supersampling for smooth edges
        let cover = 0;
        for (const [dx, dy] of [
          [0.25, 0.25],
          [0.75, 0.25],
          [0.25, 0.75],
          [0.75, 0.75],
        ]) {
          if (shape.fn(x + dx, y + dy) <= 0) cover += 0.25;
        }
        if (!cover) continue;
        const [cr, cg, cb] = hex(shape.color);
        r = r * (1 - cover) + cr * cover;
        g = g * (1 - cover) + cg * cover;
        b = b * (1 - cover) + cb * cover;
        a = a * (1 - cover) + 255 * cover;
      }
      const i = (y * size + x) * 4;
      buf[i] = Math.round(r);
      buf[i + 1] = Math.round(g);
      buf[i + 2] = Math.round(b);
      buf[i + 3] = Math.round(a);
    }
  }
  if (maskable) {
    // Full-bleed background for maskable icons.
    const [br, bg, bb] = hex('#4f46e5');
    for (let i = 0; i < buf.length; i += 4) {
      const a = buf[i + 3] / 255;
      buf[i] = Math.round(buf[i] * a + br * (1 - a));
      buf[i + 1] = Math.round(buf[i + 1] * a + bg * (1 - a));
      buf[i + 2] = Math.round(buf[i + 2] * a + bb * (1 - a));
      buf[i + 3] = 255;
    }
  }
  return png(size, buf);
}

for (const [name, size, maskable] of [
  ['icon-192.png', 192, false],
  ['icon-512.png', 512, false],
  ['icon-512-maskable.png', 512, true],
  ['apple-touch-icon.png', 180, true],
]) {
  writeFileSync(join(out, name), draw(size, maskable));
  console.info(`wrote public/icons/${name}`);
}
