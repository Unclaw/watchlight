// Bake verification: deterministic before/after screenshots + pixel diff.
// Captures two states per level (prep = pure statics; wave = statics +
// frozen gameplay objects), hiding tween-phase-dependent dynamics
// (lantern glow pulse, ambience motes, flyer lanes) so runs are comparable.
// Usage: node scripts/bake-verify.mjs <tag>        # capture: bake-shot-<tag>-L4-prep.png ...
//        node scripts/bake-verify.mjs diff         # diff before vs after
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { setTimeout as sleep } from 'node:timers/promises';

const MODE = process.argv[2] ?? 'before';
const BASE = 'http://127.0.0.1:3000';
const PORT = 9336;
const LEVELS = [4, 8];
const ROOT = process.cwd();

function decodePNG(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let off = 8, w = 0, h = 0, bpp = 3;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      bpp = data[9] === 6 ? 4 : 3;
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const out = Buffer.alloc(w * h * bpp);
  let pos = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[pos++];
    const row = raw.subarray(pos, pos + stride); pos += stride;
    const prev = out.subarray((y - 1) * stride, y === 0 ? 0 : y * stride);
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev[x] ?? 0;
      const c = x >= bpp ? prev[x - bpp] ?? 0 : 0;
      let v = row[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[x] = v & 0xff;
    }
  }
  return { w, h, bpp, data: out };
}

if (MODE === 'diff') {
  let fail = false;
  for (const lv of LEVELS) for (const st of ['prep', 'wave']) {
    const A = decodePNG(readFileSync(`${ROOT}/bake-shot-before-L${lv}-${st}.png`));
    const B = decodePNG(readFileSync(`${ROOT}/bake-shot-after-L${lv}-${st}.png`));
    if (A.w !== B.w || A.h !== B.h || A.bpp !== B.bpp) { console.log(`L${lv}-${st}: SIZE MISMATCH`); fail = true; continue; }
    let diffPx = 0, maxDelta = 0;
    let worst = { d: 0, x: 0, y: 0, a: [], b: [] };
    const n = A.data.length;
    for (let i = 0; i < n; i += A.bpp) {
      const px = (i / A.bpp) % A.w, py = Math.floor(i / A.bpp / A.w);
      let d = 0;
      for (let c = 0; c < 3; c++) d = Math.max(d, Math.abs(A.data[i + c] - B.data[i + c]));
      if (d > maxDelta) { maxDelta = d; worst = { d, x: px, y: py, a: [...A.data.subarray(i, i + 3)], b: [...B.data.subarray(i, i + 3)] }; }
      if (d > 3) diffPx++;
    }
    // structural check: 2px box blur both, diff again — AA-edge differences
    // vanish under blur; real content shifts survive
    const blur = (img) => {
      const out = Buffer.alloc(img.data.length);
      for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) {
        let r = 0, g = 0, b = 0, cnt = 0;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
          const yy = y + dy, xx = x + dx;
          if (yy < 0 || xx < 0 || yy >= img.h || xx >= img.w) continue;
          const j = (yy * img.w + xx) * img.bpp;
          r += img.data[j]; g += img.data[j + 1]; b += img.data[j + 2]; cnt++;
        }
        const o = (y * img.w + x) * img.bpp;
        out[o] = r / cnt; out[o + 1] = g / cnt; out[o + 2] = b / cnt;
      }
      return { ...img, data: out };
    };
    const BA = blur(A), BB = blur(B);
    let blurDiff = 0, blurMax = 0;
    for (let i = 0; i < n; i += A.bpp) {
      let d = 0;
      for (let c = 0; c < 3; c++) d = Math.max(d, Math.abs(BA.data[i + c] - BB.data[i + c]));
      if (d > 3) blurDiff++;
      if (d > blurMax) blurMax = d;
    }
    const pct = (100 * diffPx) / (n / A.bpp);
    const bpct = (100 * blurDiff) / (n / A.bpp);
    console.log(`L${lv}-${st}: raw: ${diffPx} (${pct.toFixed(3)}%) maxDelta=${maxDelta} | blurred: ${blurDiff} (${bpct.toFixed(3)}%) maxDelta=${blurMax} | worst@(${worst.x},${worst.y}) d=${worst.d} before=${worst.a} after=${worst.b}`);
    if (bpct > 0.1 || blurMax > 8) fail = true;
  }
  console.log(fail ? 'PIXEL DIFF: FAIL' : 'PIXEL DIFF: PASS (within bake rounding)');
  process.exit(fail ? 1 : 0);
}

// ---- capture mode ----
const proc = spawn('chromium', [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
  '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader',
  `--remote-debugging-port=${PORT}`, '--user-data-dir=/tmp/cdp-bake-profile',
  '--window-size=390,844', 'about:blank',
], { stdio: 'ignore', detached: true });
process.on('exit', () => { try { process.kill(-proc.pid, 'SIGKILL'); } catch {} });

let ws_;
for (let i = 0; i < 60; i++) {
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
    const page = (await res.json()).find((t) => t.type === 'page');
    if (page) { ws_ = new WebSocket(page.webSocketDebuggerUrl); break; }
  } catch {}
  await sleep(250);
}
await new Promise((r, j) => { ws_.onopen = r; ws_.onerror = j; });
let id = 0; const pend = new Map();
ws_.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
};
const call = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws_.send(JSON.stringify({ id: i, method, params })); });
const evalJs = async (e) => {
  const r = await call('Runtime.evaluate', { expression: e, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.text);
  return r.result?.result?.value;
};

// seed the save BEFORE the app boots: all one-time tips marked seen, so no
// tip banner can race the capture window (fresh profiles have no save to
// patch, and the banner fires at create+1.6s game time — slow headless
// clocks make its dismissal land mid-capture)
await call('Page.enable');
await call('Page.addScriptToEvaluateOnNewDocument', {
  source: `(() => {
    try {
      const KEY = 'watchlight.save';
      let env;
      try { env = JSON.parse(localStorage.getItem(KEY)) || null; } catch { env = null; }
      const data = (env && env.data && typeof env.data === 'object') ? env.data : {};
      data.tips = { 1: true, 2: true, 4: true, 6: true, 10: true };
      localStorage.setItem(KEY, JSON.stringify({ v: 1, data }));
    } catch {}
  })();`,
});

async function wake() {
  const rect = await evalJs(`(() => { const r = document.querySelector('#app canvas').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })()`);
  const cx = Math.round(rect.x + (360 / 720) * rect.w), cy = Math.round(rect.y + (420 / 1280) * rect.h);
  await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: cx, y: cy, button: 'left', clickCount: 1 });
  await sleep(30);
  await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: cx, y: cy, button: 'left', clickCount: 1 });
}

const FREEZE = `(() => {
  const s = window.__game.scene.getScene('Game');
  // hide tween-phase-dependent dynamics (identical policy before & after)
  s.lanternGlow && s.lanternGlow.setVisible(false);
  s.flyerLanes && s.flyerLanes.setVisible(false);
  s.children.list.forEach((o) => {
    if (o.texture && o.texture.key === 'dot' && (o.depth ?? 0) <= 2) o.setVisible(false); // ambience motes
  });
  return true;
})()`;

for (const lv of LEVELS) {
  for (const state of ['prep', 'wave']) {
    await evalJs(`location.href = '${BASE}/?scene=game&level=${lv}'`);
    await sleep(500);
    for (let i = 0; i < 120; i++) {
      if (await evalJs(`!!window.__game?.scene?.getScene?.('Game')?.tiles?.length`)) break;
      await sleep(100);
    }
    await wake();
    await sleep(1200);
    if (state === 'wave') {
      await evalJs(`(() => {
        const s = window.__game.scene.getScene('Game');
        s.rng = s.runeRng; // deterministic variance/spawn draws
        s.phase = 'ready';
        s.startWave();
        s.spawnQueue = [
          { kind: 'runner', at: 0 }, { kind: 'healer', at: 0 },
          { kind: 'flyer', at: 0 }, { kind: 'shielded', at: 0 },
          { kind: 'runner', at: 990000 },
        ];
        s.update(0, 16); // one deterministic tick: spawn + first step
        s.paused = true; // freeze gameplay clock for the capture
        return s.enemies.length;
      })()`);
    }
    await evalJs(FREEZE);
    await sleep(state === 'prep' ? 8000 : 3500); // let banners/tweens settle
    const shot = await call('Page.captureScreenshot', { format: 'png' });
    writeFileSync(`${ROOT}/bake-shot-${MODE}-L${lv}-${state}.png`, Buffer.from(shot.result.data, 'base64'));
    console.log(`captured bake-shot-${MODE}-L${lv}-${state}.png`);
  }
}
process.exit(0);
