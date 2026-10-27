// Generates all PWA/app icons as PNGs with zero dependencies.
// Style: dark rounded square, amber lantern diamond with glow, one cyan spark
// — identical art language to the in-game generated textures.
// Run: npm run icons
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'icons');
mkdirSync(outDir, { recursive: true });

// ---------- tiny PNG encoder ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}

function encodePNG(w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------- pixel math ----------
const smooth = (edge0, edge1, x) => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

function render(size, { rounded }) {
  const px = Buffer.alloc(size * size * 4);
  const c = size / 2;
  const radius = rounded ? size * 0.225 : size * 0.5;
  const diamondR = size * 0.155;
  const glowK = size * 0.16;
  const spark = { x: c + size * 0.215, y: c - size * 0.215, r: size * 0.028 };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;

      // background rounded-square mask (anti-aliased)
      const qx = Math.max(Math.abs(x - c) - (c - radius), 0);
      const qy = Math.max(Math.abs(y - c) - (c - radius), 0);
      const outD = Math.hypot(qx, qy) - radius;
      const mask = 1 - smooth(-1.2, 1.2, outD);

      // deep navy field with a soft radial lift
      const dc = Math.hypot(x - c, y - c) / (size * 0.7);
      const bgR = 11 + (1 - dc) * 12;
      const bgG = 16 + (1 - dc) * 20;
      const bgB = 32 + (1 - dc) * 38;

      // amber glow falloff around the diamond
      const dxn = Math.abs(x - c);
      const dyn = Math.abs(y - c);
      const dDiamond = dxn + dyn - diamondR; // L1 distance to diamond edge
      const glow = Math.exp(-Math.max(0, dDiamond) / glowK);

      // diamond body (amber) with white-hot core
      const dBody = smooth(-1.5, 1.5, dDiamond);
      const coreR = diamondR * 0.45;
      const dCore = smooth(-1.5, 1.5, dxn + dyn - coreR);

      // cyan spark dot
      const dSpark = smooth(spark.r - 1.2, spark.r + 1.2, Math.hypot(x - spark.x, y - spark.y) - spark.r);

      let r = bgR, g = bgG, b = bgB;
      // glow add
      r += glow * 150 * (1 - dBody);
      g += glow * 95 * (1 - dBody);
      b += glow * 30 * (1 - dBody);
      // body
      r = r * dBody + (1 - dBody) * 255;
      g = g * dBody + (1 - dBody) * 194;
      b = b * dBody + (1 - dBody) * 75;
      // hot core
      r = r * dCore + (1 - dCore) * 255;
      g = g * dCore + (1 - dCore) * 244;
      b = b * dCore + (1 - dCore) * 214;
      // spark
      r = r * dSpark + (1 - dSpark) * 79;
      g = g * dSpark + (1 - dSpark) * 216;
      b = b * dSpark + (1 - dSpark) * 235;

      px[i] = Math.min(255, Math.round(r));
      px[i + 1] = Math.min(255, Math.round(g));
      px[i + 2] = Math.min(255, Math.round(b));
      px[i + 3] = Math.round(mask * 255);
    }
  }
  return encodePNG(size, size, px);
}

const files = [
  ['icon-192.png', render(192, { rounded: true })],
  ['icon-512.png', render(512, { rounded: true })],
  ['icon-maskable-512.png', render(512, { rounded: false })], // full-bleed safe zone
  ['apple-touch-icon.png', render(180, { rounded: false })],
  ['favicon-64.png', render(64, { rounded: true })],
  // App Store Connect marketing icon (1024×1024, opaque, no pre-rounding)
  ['icon-1024.png', render(1024, { rounded: false })],
];
for (const [name, buf] of files) {
  writeFileSync(join(outDir, name), buf);
  console.log(`wrote public/icons/${name} (${buf.length} bytes)`);
}
