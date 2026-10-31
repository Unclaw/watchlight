#!/usr/bin/env node
// UI state screenshotter — captures the real rendered game for UI review.
// Usage: node scripts/cdp-shots.mjs [outDir] [port] [lang]
// Writes PNGs (360×~789 canvas area within 390×844 viewport) per state.
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const OUT_DIR = process.argv[2] ?? 'ui-audit';
const PORT = Number(process.argv[3] ?? '9335');
const LANG = process.argv[4] ?? 'en';
const BASE = `http://127.0.0.1:3000${LANG !== 'en' ? `/?lang=${LANG}&` : '/?'}`;
rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(OUT_DIR, { recursive: true });

const proc = spawn(
  'chromium',
  [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader',
    `--remote-debugging-port=${PORT}`, '--user-data-dir=/tmp/cdp-shots-profile',
    '--window-size=390,844', `${BASE}/?scene=game`,
  ],
  { stdio: 'ignore' },
);
await sleep(2500);
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === 'page' && t.url.startsWith('http'));
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let id = 0;
const pend = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(typeof ev.data === 'string' ? ev.data : '');
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
};
const call = (method, params = {}) =>
  new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evl = async (e, awaitPromise = false) => {
  const r = await call('Runtime.evaluate', { expression: e, awaitPromise, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(`eval failed: ${r.result.exceptionDetails.text} — ${e.slice(0, 80)}`);
  return r.result?.result?.value;
};
const state = (expr) => evl(`(() => { const s = window.__game.scene.getScene('Game'); return ${expr}; })()`);
const waitFor = async (expr, timeout = 15000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await state(expr)) return true;
    await sleep(120);
  }
  return false;
};
async function click(gx, gy) {
  const rect = await evl(`(() => { const r = document.querySelector('#app canvas').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })()`);
  await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: Math.round(rect.x + (gx / 720) * rect.w), y: Math.round(rect.y + (gy / 1280) * rect.h), button: 'left', clickCount: 1 });
  await sleep(30);
  await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: Math.round(rect.x + (gx / 720) * rect.w), y: Math.round(rect.y + (gy / 1280) * rect.h), button: 'left', clickCount: 1 });
  await sleep(250);
}
async function shot(name) {
  const r = await call('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${OUT_DIR}/${name}.png`, Buffer.from(r.result.data, 'base64'));
  console.log('shot', name);
}

try {
  await call('Page.enable');
  await call('Runtime.enable');

  // ---- game states (loaded first — scene=game jump) ----
  await waitFor(`s.tiles && s.tiles.length > 0 && s.phase === 'ready'`);
  await click(360, 420); // wake rAF
  await sleep(400);
  await shot('01-prep-hud');

  await click(440, 200); // tile 0 → build sheet (L1: 2 cards)
  await sleep(500);
  await shot('02-build-sheet-2cards');
  await click(360, 560); // dim close
  await sleep(300);

  // L2: 3 cards (orphan-row case)
  await evl(`window.__game.scene.getScene('Game').scene.restart({ mode: 'level', levelId: 2 }), true`);
  await waitFor(`s.level.id === 2 && s.phase === 'ready' && s.tiles.length > 0`);
  await sleep(600);
  await click(240, 300); // L2 tile 0
  await sleep(500);
  await shot('03-build-sheet-3cards');
  await click(360, 560);
  await sleep(300);

  // L3: 4 cards
  await evl(`window.__game.scene.getScene('Game').scene.restart({ mode: 'level', levelId: 3 }), true`);
  await waitFor(`s.level.id === 3 && s.phase === 'ready' && s.tiles.length > 0`);
  await sleep(600);
  await click(300, 240); // L3 tile 1
  await sleep(500);
  await shot('04-build-sheet-4cards');

  // tower panel: build ember, reopen
  await click(204, 1076); // ember card
  await sleep(500);
  await click(300, 240);
  await sleep(500);
  await shot('05-tower-panel');
  await click(360, 560);
  await sleep(300);

  // rune overlay + rune states
  await evl(`(window.__game.scene.getScene('Game').waveIndex = 5, window.__game.scene.getScene('Game').phase = 'wave', window.__game.scene.getScene('Game').spawnQueue = [], window.__game.scene.getScene('Game').enemies = [], true)`);
  await waitFor(`s.phase === 'rune'`);
  await sleep(500);
  await shot('06-rune-overlay');
  await click(360, 350);
  await sleep(600);
  await evl(`window.__game.scene.getScene('Game').runeButton.expand(), true`);
  await sleep(400);
  await shot('07-rune-peek-expanded');
  await evl(`window.__game.scene.getScene('Game').runeButton.collapse(), true`);
  await sleep(300);

  // wave running (remaining tracker) + boss bar
  await evl(`(window.__game.scene.getScene('Game').gold = 3000, true)`);
  await state(`s.buildTower(1, 'ember'), s.buildTower(6, 'halo'), true`);
  await state(`s.startWave(), true`);
  await waitFor(`s.phase === 'wave' && s.enemies.length > 0`);
  await sleep(600);
  await shot('08-wave-tracker');
  await evl(`(window.__game.scene.getScene('Game').spawnQueue = [{ kind: 'boss', at: 0 }, { kind: 'boss', at: 0 }], window.__game.scene.getScene('Game').enemies = [], true)`);
  await waitFor(`s.enemies.filter(e => e.isBoss).length === 2`);
  await sleep(500);
  await shot('09-boss-bar');

  // pause
  await evl(`window.__game.scene.getScene('Game').openPause(), true`);
  await sleep(500);
  await shot('10-pause');
  await evl(`window.__game.scene.getScene('Game').resume(), true`);
  await sleep(200);

  // victory screen
  await evl(`window.__game.scene.getScene('Game').victory(), true`);
  await sleep(900);
  await shot('11-victory');

  // ---- menu ----
  await evl(`window.__game.scene.getScene('Game').scene.start('Menu'), true`);
  await sleep(1200);
  await shot('12-menu');
  await click(360, 1136); // How to Play (3-button utility row, new menu layout)
  await sleep(500);
  await shot('13-how-to-play');
} catch (err) {
  console.error('SHOTS ERROR:', err.message);
  process.exitCode = 1;
} finally {
  ws.close();
  proc.kill('SIGTERM');
}
