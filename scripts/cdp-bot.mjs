#!/usr/bin/env node
// Headless play bot — drives the REAL game (prod build on :3000) through a
// full level using the same build policies as scripts/sim.mjs, logging
// per-wave state. Purpose: validate the simulator's fidelity before and
// after balance tuning. Uses the in-page API (buildTower/upgradeTower/
// startWave) + real clicks for the rune overlay.
//
// Usage: node scripts/cdp-bot.mjs [level] [policy] [port]
// Requires: npm run build && npm run preview (server on :3000)
import { spawn } from 'node:child_process';
import { build } from 'esbuild';
import { rmSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

const LEVEL = Number(process.argv[2] ?? '2');
const POLICY_NAME = process.argv[3] ?? 'meta';
const PORT = Number(process.argv[4] ?? '9333');
const PAGE_URL = `http://127.0.0.1:3000/?scene=game&level=${LEVEL}`;
const PROFILE = `/tmp/cdp-bot-profile-${PORT}`;
const WALL_CAP_MS = 30 * 60 * 1000; // hard stop — report whatever we reached

// policies come from the same bundle the sim uses (single source of truth)
const OUT = new URL('./.sim-policies.mjs', import.meta.url).pathname;
await build({
  entryPoints: [new URL('./sim-policies.ts', import.meta.url).pathname],
  bundle: true, format: 'esm', platform: 'node',
  alias: { phaser: new URL('./phaser-shim.mjs', import.meta.url).pathname },
  outfile: OUT, logLevel: 'silent',
});
const { POLICIES } = await import(pathToFileURL(OUT).href);
const policy = POLICIES.find((p) => p.level === LEVEL && p.name === POLICY_NAME);
if (!policy) throw new Error(`no policy "${POLICY_NAME}" for level ${LEVEL}`);
const steps = policy.steps;

rmSync(PROFILE, { recursive: true, force: true });
const proc = spawn(
  'chromium',
  [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader',
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
    '--window-size=390,844', PAGE_URL,
  ],
  { stdio: 'ignore' },
);

async function getPageWs() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const page = (await res.json()).find((t) => t.type === 'page' && t.url.startsWith('http'));
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* not up yet */ }
    await sleep(250);
  }
  throw new Error('no CDP page target');
}

const ws = new WebSocket(await getPageWs());
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0;
const pending = new Map();
const consoleErrors = [];
ws.onmessage = (ev) => {
  const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : '');
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error')
    consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
  if (msg.method === 'Runtime.exceptionThrown')
    consoleErrors.push(`${msg.params.exceptionDetails.text} ${msg.params.exceptionDetails.exception?.description ?? ''}`);
};
const call = (method, params = {}) =>
  new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJs = async (expression, awaitPromise = false) => {
  const r = await call('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(`page eval failed: ${r.result.exceptionDetails.text}: ${r.result.exceptionDetails.exception?.description ?? ''}`);
  return r.result?.result?.value;
};
const state = (expr) => evalJs(`(() => { const s = window.__game.scene.getScene('Game'); return ${expr}; })()`);
const waitFor = async (expr, timeoutMs = 20000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const v = await state(expr);
    if (v) return v;
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

// ---- in-page policy executor (mirrors sim tryPolicyStep semantics) ----
// Injected AFTER the ready-wait: evaluating too early can land in the
// pre-navigation-commit context and silently miss the real document.
const INJECTOR = `
  window.__bot = { ptr: 0 };
  window.__botStep = (steps) => {
    const s = window.__game.scene.getScene('Game');
    const st = window.__bot;
    const step = steps[st.ptr];
    if (!step) return false;
    if (step.build) {
      const [i, kind] = step.build;
      if (s.towerAt(i)) { st.ptr++; return true; }          // already there: skip
      if (s.gold < s.buildCost(kind)) return false;          // wait for gold
      const before = s.towers.length;
      s.buildTower(i, kind);
      if (s.towers.length === before) return false;          // denied: wait
      st.ptr++; return true;
    }
    const t = s.towerAt(step.up);
    const c = t ? t.nextCost() : null;
    if (!t || c === null) { st.ptr++; return true; }         // dead step: skip
    if (s.gold < c) return false;
    const tierBefore = t.tier;
    s.upgradeTower(t);
    if (t.tier === tierBefore) return false;
    st.ptr++; return true;
  };
  true
`;
const ensureInjected = () => evalJs(`if (!window.__bot) { ${INJECTOR} } true`);

try {
  await call('Runtime.enable');
  const ready = await evalJs(
    `(async () => {
       for (let i = 0; i < 150; i++) {
         const s = window.__game && window.__game.scene.getScene('Game');
         if (s && s.tiles && s.tiles.length > 0 && s.phase === 'ready') return true;
         await new Promise(r => setTimeout(r, 100));
       }
       return false;
     })()`,
    true,
  );
  if (!ready) throw new Error('scene never became ready');
  await ensureInjected();
  await click(360, 420); // wake rAF (backgrounded-tab quirk)
  await click(646, 1188); // speed ×2
  console.log(`BOT L${LEVEL} "${POLICY_NAME}" (${policy.desc}) — ${policy.steps.length} steps, waves: ${await state('s.level.waves.length')}`);

  const rows = [];
  let lastWaveIdx = 1;
  let lastLeaks = 0;
  const t0 = Date.now();
  let outcome = 'timeout';

  while (Date.now() - t0 < WALL_CAP_MS) {
    await ensureInjected(); // self-heal if the context was swapped under us
    const s = await state(
      `({ phase: s.phase, wave: s.waveIndex, hp: s.hp, leaks: s.leaks, gold: s.gold, towers: s.towers.length, ptr: window.__bot.ptr })`,
    );
    // a wave completed when waveIndex moved past lastWaveIdx (and we're not mid-spawn of it)
    if (s.wave > lastWaveIdx && (s.phase === 'ready' || s.phase === 'rune' || s.phase === 'won' || s.phase === 'over')) {
      rows.push({ wave: lastWaveIdx, hp: s.hp, leaks: s.leaks - lastLeaks, gold: s.gold });
      lastLeaks = s.leaks;
      lastWaveIdx = s.wave;
    }
    if (s.phase === 'over') { outcome = 'defeat'; break; }
    if (s.phase === 'won') { outcome = 'victory'; break; }
    if (s.phase === 'rune') {
      const offered = (await state('s.pendingRuneChoices.map(r => r.id)')) ?? [];
      let idx = offered.length - 1;
      for (const want of policy.runePriority) {
        const i = offered.indexOf(want);
        if (i >= 0) { idx = i; break; }
      }
      await click(360, 390 + idx * 250);
      await sleep(500);
      continue;
    }
    if (s.phase === 'ready') {
      // execute affordable policy steps (esp. the opening build before wave 1), then start
      await evalJs(`(() => { let g = 0; while (window.__botStep(${JSON.stringify(steps)}) && g++ < 20); return g; })()`);
      await state('s.startWave(), true');
      continue;
    }
    // mid-wave: keep executing policy while affordable
    await evalJs(`(() => { let g = 0; while (window.__botStep(${JSON.stringify(steps)}) && g++ < 20); return g; })()`);
    await sleep(150);
  }

  const final = await state(`({ hp: s.hp, leaks: s.leaks, gold: s.gold, wave: s.waveIndex, ptr: window.__bot.ptr })`);
  console.log(`OUTCOME: ${outcome} | final hp ${final.hp} | leaks ${final.leaks} | wave ${final.wave}/${await state('s.level.waves.length')} | steps ${final.ptr}/${steps.length} | ${Math.round((Date.now() - t0) / 1000)}s wall`);
  console.log('wave | hp | leaksThisWave | goldAfter');
  for (const r of rows) console.log(`${String(r.wave).padStart(4)} | ${String(r.hp).padStart(2)} | ${String(r.leaks).padStart(13)} | ${r.gold}`);
  if (consoleErrors.length) { console.log('console errors:', consoleErrors.slice(0, 5)); process.exitCode = 1; }
  if (outcome === 'timeout') process.exitCode = 1;
} catch (err) {
  console.error('BOT ERROR:', err.message);
  process.exitCode = 1;
} finally {
  ws.close();
  proc.kill('SIGTERM');
}
