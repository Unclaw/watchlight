// CPU/frame profiler for perf work (2026-11-11 overheating investigation).
// Derives from the cdp-smoke harness (boot/eval/wake-click gotchas apply).
// Boots the REAL game under SwiftShader (a proxy for a weak/thermally
// throttled mobile GPU), forces a controlled enemy load via the spawn queue,
// and collects a CDP CPU profile + per-frame interval stats.
// Usage: node scripts/cdp-perf.mjs [scenario]   (server must be running)
// Scenarios: empty | mob60 | mob60heal | all (default)
import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const BASE = 'http://127.0.0.1:3000';
const SCENARIOS = process.argv[2] && process.argv[2] !== 'all'
  ? process.argv[2].split(/[ ,]+/)
  : ['empty', 'mob60', 'mob60heal', 'mob60heal_nodecor'];
const RUN_MS = 15_000; // profile window per scenario (wall)
const PORT = 9333;
const PROFILE = '/tmp/cdp-perf-profile';

rmSync(PROFILE, { recursive: true, force: true });
const proc = spawn(
  'chromium',
  [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader',
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
    '--window-size=390,844', 'about:blank',
  ],
  { stdio: 'ignore', detached: true },
);
process.on('exit', () => { try { process.kill(-proc.pid, 'SIGKILL'); } catch { /* already gone */ } });

async function getPageWs() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const page = (await res.json()).find((t) => t.type === 'page' && t.url !== 'about:blank' || t.type === 'page');
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
  if (r.result?.exceptionDetails) throw new Error(`page eval failed: ${r.result.exceptionDetails.text} :: ${expression.slice(0, 120)}`);
  return r.result?.result?.value;
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

/** Frame-interval sampler installed in-page: hooks Phaser's POST_RENDER
 * event into a preallocated ring buffer (no per-frame allocation). */
const INSTALL_SAMPLER = `(() => {
  const g = window.__game;
  const N = 8192, buf = new Float64Array(N);
  let i = 0, last = 0;
  g.events.on('postrender', () => {
    const t = performance.now();
    if (last) { buf[i++ % N] = t - last; }
    last = t;
  });
  window.__perfFrames = { buf, N, count: () => Math.min(i, N) };
  return true;
})()`;

async function setupScenario(name) {
  await evalJs(`location.href = '${BASE}/?scene=game&level=4'`);
  await sleep(400);
  // wait until GameScene created, then install the frame sampler FIRST
  for (let i = 0; i < 120; i++) {
    const ok = await evalJs(`(() => { const s = window.__game?.scene?.getScene?.('Game'); return !!(s && s.tiles && s.tiles.length === 12); })()`);
    if (ok) break;
    await sleep(100);
  }
  await evalJs(INSTALL_SAMPLER);
  await click(360, 420); // wake click (rAF frozen until first input headless)

  // build a realistic mid-game board: 6 towers, 2 of them maxed
  await evalJs(`(() => {
    const s = window.__game.scene.getScene('Game');
    s.gold = 100000;
    s.buildTower(0, 'ember'); s.buildTower(3, 'prism'); s.buildTower(6, 'kiln');
    s.buildTower(1, 'ember'); s.buildTower(4, 'halo'); s.buildTower(7, 'kiln');
    for (const t of s.towers) { s.upgradeTower(t); }
    s.upgradeTower(s.towers[0]); s.upgradeTower(s.towers[2]);
    // unkillable lantern so leaks never end the run mid-profile
    s.hp = 999999; s.maxHp = 999999;
    return s.towers.length;
  })()`);

  const load = name.replace(/_nodecor|_nosky/, '');
  if (load !== 'empty') {
    const healers = load === 'mob60heal' ? 12 : 0;
    const runners = 60 - healers;
    await evalJs(`(() => {
      const s = window.__game.scene.getScene('Game');
      s.phase = 'ready';
      s.startWave();
      const q = [];
      for (let i = 0; i < ${runners}; i++) q.push({ kind: 'runner', at: i * 40 });
      for (let i = 0; i < ${healers}; i++) q.push({ kind: 'healer', at: 200 + i * 300 });
      q.push({ kind: 'runner', at: 999000 }); // keep the wave alive forever
      s.spawnQueue = q;
      return q.length;
    })()`);
  }

  if (load !== 'empty') {
    // count heal-mote emissions (the healer visual surcharge)
    await evalJs(`(() => { const s = window.__game.scene.getScene('Game');
      const orig = s.fx.motes.bind(s.fx);
      s.fx.motes = (n, x, y) => { window.__healCount = (window.__healCount || 0) + n; return orig(n, x, y); };
      return true; })()`);
    if (name.endsWith('_nodecor')) {
    // hide static ambience/decor (depth <= 2: stars, trees, moon, chevrons,
    // flyer lanes, aura rings, glow underlay) to measure its render share
    await evalJs(`(() => { const s = window.__game.scene.getScene('Game');
      let n = 0;
      s.children.list.forEach((o) => { if ((o.depth ?? 0) <= 2) { o.setVisible(false); n++; } });
      return n; })()`);
  }
  if (name.endsWith('_nosky')) {
    // also hide the additive overlay pass: vignette corners (7), lantern glow (8)
    await evalJs(`(() => { const s = window.__game.scene.getScene('Game');
      let n = 0;
      s.children.list.forEach((o) => { const d = o.depth ?? 0; if (d <= 2 || d === 7 || d === 8) { o.setVisible(false); n++; } });
      return n; })()`);
  }

  // tank-up loop: keep everything alive & permanently "damaged" so healers
    // heal at full rate and hp bars are all drawn (worst case, sustained);
    // speed ~0 so the mob STAYS on the field (no leaks draining it)
    const tank = setInterval(() => {
      evalJs(`(() => { const s = window.__game.scene.getScene('Game');
        let i = 0;
        for (const e of s.enemies) {
          e.core.maxHp = 1e9; e.core.hp = 5e8; e.core.speed = Math.min(e.core.speed, 9);
          if (!e.core.flyFrom && e.core.dist < 1050) e.core.dist = ${load === 'mob60heal' ? '1140' : '1050 + ((i++ * 37) % 500)'};
        }
        return s.enemies.length; })()`).catch((e) => console.error('tank eval failed', e));
    }, 500);
    return () => clearInterval(tank);
  }
  return () => {};
}

async function profileScenario(name) {
  console.log(`\n=== scenario: ${name} ===`);
  const stopTank = await setupScenario(name);
  // let the load build up before sampling
  await sleep(name === 'empty' ? 1500 : 9000);

  await call('Profiler.enable');
  await call('Profiler.setSamplingInterval', { interval: 500 });
  await call('Profiler.start');
  const t0 = Date.now();
  const enemySamples = [];
  while (Date.now() - t0 < RUN_MS) {
    enemySamples.push(await evalJs(`(() => { const s = window.__game.scene.getScene('Game');
      const h = s.enemies.filter(e => e.kind === 'healer');
      const peers = h[0] ? s.enemies.filter(e => e !== h[0] && Math.hypot(e.x - h[0].x, e.y - h[0].y) < 130).length : -1;
      return { enemies: s.enemies.length, bolts: s.bolts.length, healers: h.length, peersNear: peers,
               hTick: h[0] ? Math.round(h[0].core.healTick) : -1, motes: window.__healCount || 0 }; })()`));
    await sleep(1000);
  }
  const r = await call('Profiler.stop');
  const profile = r.result?.profile;
  stopTank();

  // ---- frame stats ----
  const frames = await evalJs(`(() => {
    const { buf, N, count } = window.__perfFrames;
    const a = Array.from(buf.subarray(0, count())).filter((v) => v > 0 && v < 1000).sort((x, y) => x - y);
    const q = (p) => a.length ? a[Math.floor(a.length * p)] : 0;
    return { n: a.length, p50: q(0.5), p90: q(0.9), p99: q(0.9), max: a[a.length - 1] ?? 0,
             avg: a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0, heal: window.__healCount || 0 };
  })()`);
  const avgEnemies = enemySamples.length
    ? Math.round(enemySamples.reduce((s, v) => s + v.enemies, 0) / enemySamples.length)
    : 0;
  const avgBolts = enemySamples.length
    ? Math.round(enemySamples.reduce((s, v) => s + v.bolts, 0) / enemySamples.length)
    : 0;
  console.log(`enemies(avg)=${avgEnemies} bolts(avg)=${avgBolts} heal-motes=${frames.heal}`,
    `healers=${enemySamples.map((s) => s.healers).join('/')} peersNear=${enemySamples.map((s) => s.peersNear).join('/')} motes/s=${enemySamples.map((s) => s.motes).join('/')}`);
  console.log(`frames n=${frames.n}  avg=${frames.avg.toFixed(1)}ms  p50=${frames.p50.toFixed(1)}  p90=${frames.p90.toFixed(1)}  max=${frames.max.toFixed(1)}  (~${(1000 / Math.max(frames.avg, 0.01)).toFixed(0)} fps avg)`);

  // ---- profile: aggregate self time per function ----
  const self = new Map(); // key -> us
  for (const n of profile.nodes) {
    if (!n.hitCount) continue;
    const cf = n.callFrame;
    const url = cf.url || '';
    const short = url.includes('/src/') ? url.slice(url.lastIndexOf('/src/'))
      : url.includes('phaser') ? '[phaser]'
      : url.includes('vite') || url.includes('node_modules') ? '[deps]'
      : url ? url.split('/').slice(-1)[0]
      : cf.functionName === '(garbage collector)' ? '[GC]'
      : '[native]';
    const key = `${cf.functionName || '(anon)'}  ${short}:${cf.lineNumber + 1}`;
    self.set(key, (self.get(key) ?? 0) + n.hitCount);
  }
  const interval = profile.samplingInterval ?? 500;
  const totalUs = [...self.values()].reduce((a, b) => a + b, 0) * interval;
  const jsUs = [...self.entries()].filter(([k]) => !k.startsWith('(program)') && !k.startsWith('(idle)') && !k.startsWith('(garbage'))
    .reduce((a, [, v]) => a + v, 0) * interval;
  console.log(`sampled busy ~${(totalUs / 1e6).toFixed(2)}s (JS-visible ${(jsUs / 1e6).toFixed(2)}s) over ${RUN_MS / 1000}s wall`);
  const top = [...self.entries()]
    .sort((a, b) => b[1] - a[1]).slice(0, 22)
    .map(([k, v]) => `${((v * interval) / 1e3).toFixed(0).padStart(6)}ms ${(100 * v * interval / totalUs).toFixed(1).padStart(5)}%  ${k}`)
    .join('\n');
  console.log(top);

  // per-source-file rollup
  const byFile = new Map();
  for (const [k, v] of self) {
    const file = k.match(/\[phaser\]|\[GC\]|\[native\]|\[deps\]|\/src\/[^\s:]+/)?.[0] ?? 'other';
    byFile.set(file, (byFile.get(file) ?? 0) + v);
  }
  console.log('\n-- by source --');
  console.log([...byFile.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
    .map(([k, v]) => `${((v * interval) / 1e3).toFixed(0).padStart(6)}ms  ${k}`).join('\n'));
}

for (const sc of SCENARIOS) await profileScenario(sc);
process.exit(0);
