// Headless smoke-check: decodes a PNG screenshot (no deps) and reports
// colour coverage so we can assert the game actually rendered.
// Usage: node scripts/check-shot.mjs <file.png> [more.png ...]
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

function decodePNG(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let off = 8;
  let w = 0, h = 0, bitDepth = 0, colorType = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (bitDepth !== 8 || (colorType !== 6 && colorType !== 2)) {
    throw new Error(`unsupported PNG (depth=${bitDepth} color=${colorType})`);
  }
  const bpp = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const px = Buffer.alloc(h * stride);
  const paeth = (a, b, c) => {
    const p = a + b - c;
    const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  for (let y = 0; y < h; y++) {
    const filter = raw[y * (stride + 1)];
    const row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const prev = y > 0 ? px.subarray((y - 1) * stride, y * stride) : null;
    const out = px.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[x - bpp] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= bpp ? prev[x - bpp] : 0;
      let v = row[x];
      if (filter === 1) v = (v + a) & 0xff;
      else if (filter === 2) v = (v + b) & 0xff;
      else if (filter === 3) v = (v + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) v = (v + paeth(a, b, c)) & 0xff;
      out[x] = v;
    }
  }
  return { w, h, bpp, px };
}

const near = (r, g, b, R, G, B, tol) =>
  Math.abs(r - R) <= tol && Math.abs(g - G) <= tol && Math.abs(b - B) <= tol;

for (const file of process.argv.slice(2)) {
  const { w, h, bpp, px } = decodePNG(readFileSync(file));
  let nonBg = 0, amber = 0, red = 0, cyan = 0, violet = 0, white = 0, muted = 0, green = 0;
  const colors = new Set();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * bpp;
      const r = px[i], g = px[i + 1], b = px[i + 2];
      colors.add((r >> 4) << 8 | (g >> 4) << 4 | (b >> 4));
      if (!(r < 40 && g < 45 && b < 70)) nonBg++;
      if (near(r, g, b, 255, 194, 75, 60)) amber++;
      if (near(r, g, b, 255, 95, 122, 60)) red++;
      if (near(r, g, b, 79, 216, 235, 50)) cyan++;
      if (near(r, g, b, 71, 224, 160, 55)) green++;
      if (near(r, g, b, 155, 140, 255, 50)) violet++;
      if (r > 200 && g > 200 && b > 200) white++;
      if (near(r, g, b, 147, 161, 196, 40)) muted++;
    }
  }
  const pct = (n) => ((n / (w * h)) * 100).toFixed(2) + '%';
  console.log(`${file}: ${w}x${h}, distinct-colors=${colors.size}, non-bg=${pct(nonBg)}, amber=${pct(amber)}, red=${pct(red)}, cyan=${pct(cyan)}, green=${pct(green)}, violet=${pct(violet)}, white=${pct(white)}, muted=${pct(muted)}`);
}
