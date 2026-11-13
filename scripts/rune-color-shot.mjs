// Visual proof-shot for rune accent colours: injects the two Wisp Grove
// runes into the rune peek list (as the game renders them — same
// makeRuneIcon path) and screenshots the expanded card.
// Usage: node scripts/rune-color-shot.mjs <accentHex> <tag>
//   e.g. node scripts/rune-color-shot.mjs 0x9b8cff before
// Serves from :3000 (must be running) — rebuild first for source changes.
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const ACCENT = process.argv[2] ?? '0x9b8cff';
const TAG = process.argv[3] ?? 'shot';
const URL = 'http://127.0.0.1:3000/?scene=game';
const PORT = 9334;
const PROFILE = '/tmp/cdp-rune-shot-profile';

rmSync(PROFILE, { recursive: true, force: true });
// detached + own process group: SwiftShader leaves an orphaned GPU child at
// 300% CPU if only the parent is killed (MEMORY gotcha)
const proc = spawn(
  'chromium',
  [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader',
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
    '--window-size=390,844', URL,
  ],
  { stdio: 'ignore', detached: true },
);

const killTree = () => {
  try { process.kill(-proc.pid, 'SIGKILL'); } catch { try { proc.kill('SIGKILL'); } catch {} }
};
process.on('exit', killTree);

async function getPageWs() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await res.json();
      const page = list.find((t) => t.type === 'page' && t.url.startsWith('http'));
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* devtools not up yet */ }
    await sleep(250);
  }
  throw new Error('no CDP page target');
}

const ws = new WebSocket(await getPageWs());
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let id = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : '');
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
};
const call = (method, params = {}) =>
  new Promise((res) => {
    const i = ++id;
    pending.set(i, res);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
const evalJs = async (expression, awaitPromise = false) => {
  const r = await call('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
  if (r.result?.exceptionDetails) {
    const d = r.result.exceptionDetails;
    throw new Error(`page eval failed: ${d.text} ${d.exception?.description ?? ''}`);
  }
  return r.result?.result?.value;
};
const state = (expr) => evalJs(`(() => { const s = window.__game.scene.getScene('Game'); return ${expr}; })()`);
const waitFor = async (expr, timeoutMs = 10000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (await state(expr)) return true;
    await sleep(120);
  }
  return false;
};
async function click(gameX, gameY) {
  const rect = await evalJs(
    `(() => { const r = document.querySelector('#app canvas').getBoundingClientRect();
       return { x: r.left, y: r.top, w: r.width, h: r.height }; })()`,
  );
  const cx = Math.round(rect.x + (gameX / 720) * rect.w);
  const cy = Math.round(rect.y + (gameY / 1280) * rect.h);
  await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: cx, y: cy, button: 'left', clickCount: 1 });
  await sleep(30);
  await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: cx, y: cy, button: 'left', clickCount: 1 });
}

try {
  await call('Runtime.enable');

  // GameScene fully created (rune button exists)
  const ready = await evalJs(
    `(async () => {
       for (let i = 0; i < 120; i++) {
         const s = window.__game && window.__game.scene.getScene('Game');
         if (s && s.runeButton) return true;
         await new Promise(r => setTimeout(r, 100));
       }
       return false;
     })()`,
    true,
  );
  if (!ready) throw new Error('game scene not ready');

  // headless rAF stays frozen until the first real input — wake the clocks
  await click(360, 420);
  if (!(await waitFor('s.runeButton && s.sys.game.loop.actualFps > 0'))) {
    throw new Error('clocks not ticking after wake');
  }

  // inject both grove runes through the REAL render path (makeRuneIcon reads
  // only glyph + accent; the bytes below come from the build being served)
  await evalJs(`(() => {
    const s = window.__game.scene.getScene('Game');
    s.runeButton.addRune({ id: 'deepRoots', name: 'Deep Roots', accent: 0x47e0a0, glyph: 'grove',
      desc: 'Wisp Grove reach +30%.' });
    s.runeButton.addRune({ id: 'oldGrowth', name: 'Old Growth', accent: ${ACCENT}, glyph: 'sparkle',
      desc: 'Wisp Grove empower is 50% stronger.' });
    s.runeButton.expand();
    return s.runeButton.runes.map(r => r.id).join(',');
  })()`);
  if (!(await waitFor('s.runeButton.expanded === true'))) throw new Error('card did not expand');

  // let the expand tween settle (300ms Back ease), then one more frame
  await sleep(450);
  const shot = await call('Page.captureScreenshot', { format: 'png' });
  if (!shot.result?.data) throw new Error('no screenshot data');
  const out = `rune-color-${TAG}.png`;
  writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
  console.log(`OK  ${out}  (oldGrowth accent ${ACCENT})`);
} finally {
  killTree();
  await sleep(300);
  try {
    const left = execFileSync('pgrep', ['-f', 'chromiu[m]'], { encoding: 'utf8' }).trim();
    if (left) console.error(`WARN orphan chromium: ${left.split('\\n').join(' ')}`);
    else console.log('chromium tree cleaned');
  } catch { console.log('chromium tree cleaned'); }
  ws.close();
}
