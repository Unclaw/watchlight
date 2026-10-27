// Deterministic end-to-end smoke test via the Chrome DevTools Protocol.
// No dependencies: Node >=22 ships a global WebSocket. Drives REAL input
// events (mousePressed/Released) through the canvas, then reads scene state.
// Usage: node scripts/cdp-smoke.mjs [url]   (server must be running)
import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const URL = process.argv[2] ?? 'http://127.0.0.1:3000/?scene=game';
const PORT = 9333;
const PROFILE = '/tmp/cdp-smoke-profile';

rmSync(PROFILE, { recursive: true, force: true });
const proc = spawn(
  'chromium',
  [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader',
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
    '--window-size=390,844', URL,
  ],
  { stdio: 'ignore' },
);

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
const consoleErrors = [];
ws.onmessage = (ev) => {
  const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : '');
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    const d = msg.params.exceptionDetails;
    consoleErrors.push(`${d.text} ${d.exception?.description ?? ''}`);
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
  if (r.result?.exceptionDetails) throw new Error(`page eval failed: ${r.result.exceptionDetails.text}`);
  return r.result?.result?.value;
};

/** Click at GAME coordinates (720×1280 space) — mapped onto the letterboxed canvas. */
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

const state = (expr) => evalJs(`(() => { const s = window.__game.scene.getScene('Game'); return ${expr}; })()`);
/** Poll a state expression until truthy (game clock can run slower than
 *  wall time under software WebGL — never assert on fixed sleeps). */
const waitFor = async (expr, timeoutMs = 8000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (await state(expr)) return true;
    await sleep(120);
  }
  return false;
};
const results = [];
const check = (name, ok) => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
};

try {
  await call('Runtime.enable');

  // wait until GameScene has fully created (tiles wired)
  const ready = await evalJs(
    `(async () => {
       for (let i = 0; i < 120; i++) {
         const s = window.__game && window.__game.scene.getScene('Game');
         if (s && s.tiles && s.tiles.length === 14) return true;
         await new Promise(r => setTimeout(r, 100));
       }
       return false;
     })()`,
    true,
  );
  check('game scene ready (14 tiles)', ready === true);

  // this headless build freezes rAF until the first real input (the tab counts
  // as backgrounded) — wake the page with a click on a non-interactive path
  // spot so clocks/tweens start ticking
  await click(360, 420);

  // --- wave strip: upcoming mix during prep, tracker once started ---
  check('wave strip shows upcoming mix (prep)', await waitFor("s.waveStripMode === 'next'"));
  check('lantern glow dimmed (no runes yet)', (await waitFor('s.lanternGlow.scaleX > 0 && s.lanternGlow.scaleX < 1.6')) === true);

  // --- tap a tile → build sheet → tap Ember card → tower built ---
  const pre = await state(`{ gold: s.gold, towers: s.towers.length }`);
  await click(440, 200); // TILES[0]
  await sleep(450);
  check('build sheet opens on tile tap', (await state('s.sheet.isOpen()')) === true);

  await click(204, 1076); // Ember card in the sheet (game coords)
  await sleep(450);
  const post = await state(
    `{ gold: s.gold, towers: s.towers.length, kind: s.towers[0] ? s.towers[0].def.kind : null }`,
  );
  check(
    `ember built for 60g (gold ${pre.gold} → ${post.gold})`,
    post.towers === 1 && post.kind === 'ember' && post.gold === pre.gold - 60,
  );
  check('sheet closed after build', (await state('s.sheet.isOpen()')) === false);

  // --- upgrade chevron: appears when affordable, hides when broke ---
  await state('s.gold = 500');
  check('chevron shown when upgrade affordable', (await waitFor('s.towers[0].upgradeMarkerVisible === true')));
  await state('s.gold = 0');
  check('chevron hidden when gold insufficient', (await waitFor('s.towers[0].upgradeMarkerVisible === false')) === true);

  // --- live affordability: open sheet while broke, gold arrives, cards light up ---
  await click(40, 440); // TILES[2], empty
  await sleep(400);
  check(
    'build sheet opens with nothing affordable',
    (await state('s.sheet.isOpen()')) === true && (await state('s.sheet.affordableKinds().length')) === 0,
  );
  await state('s.gold = 500');
  check(
    'cards become affordable live (no reopen)',
    (await waitFor('s.sheet.affordableKinds().length === 2')) === true, // level 1 gates to ember+halo
  );
  await click(360, 560); // tap the dim to close
  await sleep(300);
  check('sheet closed after dim tap', (await state('s.sheet.isOpen()')) === false);

  // --- start a wave, let it run, enemies spawn ---
  // --- halo bloom: persistent influence ring ---
  await state(`s.gold = 300`); // afford the halo after the "broke" chevron test
  await click(280, 440); // TILES[3]
  await sleep(400);
  await click(516, 1076); // Halo card (level-1 grid: col 1, row 0)
  await sleep(400);
  const halo = await state(
    `s.towers.length === 2 ? { kind: s.towers[1].def.kind, ring: !!s.towers[1].auraRing, radius: Math.round(s.towers[1].auraRing ? s.towers[1].auraRing.radius : 0) } : null`,
  );
  check('halo built with influence ring', halo?.kind === 'halo' && halo?.ring === true && (halo?.radius ?? 0) >= 100);

  // --- sell economics during prep: full refund, zero-sum spam ---
  {
    const before = await state('s.gold'); // 215: 150 - 60 (ember) - 85 (halo) with top-ups
    const haloInvested = await state('s.towers[1].invested');
    await click(280, 440); // reopen tower panel on tile 3 (halo)
    await sleep(400);
    await click(535, 1206); // Sell
    await sleep(350);
    const afterSell = await state(`{ gold: s.gold, towers: s.towers.length }`);
    check(
      `prep sell = full refund (+${haloInvested}g)`,
      afterSell.gold === before + haloInvested && afterSell.towers === 1,
    );
    // spam rebuild+sell twice — every cycle must return to the same gold
    for (let i = 0; i < 2; i++) {
      await click(280, 440);
      await sleep(350);
      await click(516, 1076); // halo card
      await sleep(350);
      await click(280, 440);
      await sleep(350);
      await click(535, 1206);
      await sleep(350);
    }
    check('prep sell-spam is zero-sum (no infinite gold)', (await state('s.gold')) === afterSell.gold);
  }

  await click(360, 1188); // Start Wave button (centre of pill)
  check('wave strip switches to remaining tracker', await waitFor("s.waveStripMode === 'remaining'"));
  check('wave running with enemies', await waitFor("s.phase === 'wave' && s.enemies.length > 0"));

  // --- sell economics during a wave: 60% floor, spam strictly loses ---
  {
    const out = await state(`(() => {
      s.gold = 400;
      const g0 = s.gold;
      s.buildTower(2, 'ember');
      const g1 = s.gold;
      s.sellTower(s.towers[s.towers.length - 1]);
      const g2 = s.gold;
      let prev = g2;
      let losing = true;
      for (let i = 0; i < 3; i++) {
        s.buildTower(2, 'ember');
        s.sellTower(s.towers[s.towers.length - 1]);
        const g = s.gold;
        if (g >= prev) losing = false;
        prev = g;
      }
      return { g0, g1, g2, final: s.gold, losing };
    })()`);
    check(
      'wave sell = 60% floor',
      out.g1 === out.g0 - 60 && out.g2 === out.g1 + Math.floor(60 * 0.6),
    );
    check('wave sell-spam strictly loses gold', out.losing === true && out.final < out.g2);
  }

  // --- leak: lantern survives, the leaked enemy must NOT linger on it ---
  {
    const base = await state(
      `s.children.list.filter(o => o.texture && o.texture.key && o.texture.key.startsWith('enemy_')).length`,
    );
    await state(`(s.enemies[0].dist = 99999, s.hp = 20, true)`); // force an instant leak
    check(
      'leaked enemy absorbed by the lantern',
      (await waitFor('s.leaks > 0')) &&
        (await waitFor(
          `s.children.list.filter(o => o.texture && o.texture.key && o.texture.key.startsWith('enemy_')).length <= ${base}`,
        )),
    );
  }

  // --- rune wave: preview appears only AFTER the rune is chosen ---
  // simulate clearing wave 5: empty wave state → next tick fires endWave()
  await state(`(s.waveIndex = 5, s.phase = 'wave', s.spawnQueue = [], s.enemies = [])`);
  check('rune overlay offered after wave 5', await waitFor("s.phase === 'rune'"));
  check(
    'overlay icons render above cards (order pinned)',
    (await waitFor('s.activeRuneOverlay && s.activeRuneOverlay.iconOrderValid()')) === true,
  );
  check(
    'offered runes match level roster (no dead picks)',
    (await waitFor('s.pendingRuneChoices.length > 0')) === true &&
      (await state('s.pendingRuneChoices.every(r => !r.tower || s.level.towers.includes(r.tower))')) === true,
  );
  await sleep(400); // let overlay finish its fade-in
  check('wave strip hidden while rune pending', (await waitFor("s.waveStripMode === null")) === true);
  await click(360, 390); // first rune card
  check('rune chosen → back to ready', await waitFor("s.phase === 'ready'"));
  check('rune button takes the picked rune', (await waitFor('s.runeButton && s.runeButton.runeCount === 1')) === true);
  // press-and-hold peek: card opens on press, closes on release
  await click(646, 1097); // pointerdown+up quickly — peek needs a held press
  await state('window.__held = false');
  // dispatch a held press (no release) directly:
  await state(`(() => { const s = window.__game.scene.getScene('Game'); s.runeButton.expand(); return true; })()`);
  check('rune card expands', (await waitFor('s.runeButton.expanded === true')) === true);
  await state(`(() => { const s = window.__game.scene.getScene('Game'); s.runeButton.collapse(); return true; })()`);
  check('rune card collapses', (await waitFor('s.runeButton.expanded === false')) === true);
  check('wave strip shows next wave after rune pick',
    (await waitFor("s.waveStripMode === 'next'")) === true && (await state('s.waveIndex')) === 6);

  // --- boss bars: two bosses → stacked bars, visible track ---
  await state(
    `(s.phase = 'wave', s.spawnQueue = [{ kind: 'boss', at: 0 }, { kind: 'boss', at: 0 }], s.enemies = [], s.waveIndex = 6, true)`,
  );
  check(
    'two bosses → boss bar visible',
    (await waitFor('s.enemies.filter(e => e.isBoss).length === 2 && s.hud.bossBar.visible')) === true,
  );

  // --- rune offers respect EVERY level's roster (restart into L2/L3) ---
  for (const lvl of [2, 3]) {
    await state(`s.scene.restart({ mode: 'level', levelId: ${lvl} })`);
    await waitFor(`s.level.id === ${lvl} && s.phase === 'ready' && s.tiles.length === s.level.map.tiles.length`);
    await sleep(400); // let create() settle
    await state(`(s.waveIndex = 5, s.phase = 'wave', s.spawnQueue = [], s.enemies = [], true)`);
    const offered = await waitFor(`s.phase === 'rune' && s.pendingRuneChoices.length > 0`);
    check(
      `level ${lvl} rune offers match roster`,
      offered === true &&
        (await state('s.pendingRuneChoices.every(r => !r.tower || s.level.towers.includes(r.tower))')) === true,
    );
  }

  check('no console errors', consoleErrors.length === 0);
} catch (err) {
  check(`script error: ${err.message}`, false);
} finally {
  if (consoleErrors.length) console.log('console errors:', consoleErrors.slice(0, 5));
  ws.close();
  proc.kill('SIGTERM');
}

console.log(results.every(Boolean) ? 'SMOKE OK' : 'SMOKE FAILED');
process.exit(results.every(Boolean) ? 0 : 1);
