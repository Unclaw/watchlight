// Headless balance simulator — runs the REAL game logic at a fixed 60fps
// step against the REAL data from src/config.ts (via the phaser shim alias)
// and the REAL rune modifiers from src/runes.ts.
//
// H1-LITE (2026-11-04): all combat-relevant logic is the SHARED Phaser-free
// core in src/sim/ — this file no longer mirrors GameScene/Enemy/Tower by
// hand; it orchestrates the same functions the game runs:
//   - src/sim/enemy.ts   spawn (rng order contractual), step, damage/slow/burn,
//                        posAhead lead, heartwood summon drops
//   - src/sim/combat.ts  targeting, beam/splash/chain resolution, bolts, shells
//   - src/sim/stats.ts   effective tower stats (runes + grove buffs), costs
//   - src/sim/waves.ts   spawn queue, rune offering pool + instants, leak dmg
// Sim-only concerns remain here: policy execution, wave flow, run results.
// NOT modeled (unchanged): visuals, audio, sell/reposition, prep idle time
// (waves start instantly — no gameplay time passes between waves anyway),
// and the game-side flyer dip (linear flight here, by design — see
// stepEnemyCore docs).
import {
  COMBAT, EnemyKind, LEVELS, LevelDef, PathIndex, Pt, TowerKind, TOWERS,
  makePath, waveBonus, waveGroups,
} from '../src/config';
import { Rng } from '../src/rng';
import { hasChains, hasSlowBurn } from '../src/runes';
import {
  towerBuildCost, towerDmg, towerNextCost, towerRange, towerRate, towerSlow, towerSplash,
} from '../src/sim/stats';
import {
  applyBurnCore, applySlowCore, damageEnemyCore, EnemyCore, killBounty, posAheadCore,
  spawnEnemyCore, splashAdjusted, stepEnemyCore, summonDropDists,
} from '../src/sim/enemy';
import {
  acquireTarget, auraHits, beamGeom, beamHits, beamWidth, chainTargets, splashHits,
  stepBoltCore, stepShellCore,
} from '../src/sim/combat';
import { buildSpawnQueue, leakDamage, runeInstants, runeOfferPool } from '../src/sim/waves';
import { POLICIES, Policy } from './sim-policies';
import { dist } from '../src/sim/geom';

const DT = 1000 / 60; // fixed-step frames (game caps delta at 100ms; 60fps is the device norm)

/** SimEnemy IS the shared EnemyCore — the same state the game's Enemy
 * entity wraps (src/sim/enemy.ts). */
type SimEnemy = EnemyCore;

/** Tower state holder — effective stats come from the shared core
 * (src/sim/stats.ts), same functions the game's Tower getters use. */
class SimTower {
  tier = 0;
  cooldown = 0;
  auraTick = 0;
  constructor(readonly kind: TowerKind, readonly tileIndex: number, readonly x: number, readonly y: number) {}
}

interface SimBolt { x: number; y: number; target: SimEnemy | null; dest: Pt; speed: number; dmg: number; dead: boolean; }
interface SimShell { from: Pt; to: Pt; t: number; dmg: number; radius: number; dead: boolean; }

export interface WaveLog {
  wave: number; cleared: boolean; hpAfter: number; goldAfter: number;
  leaks: number; hpLost: number; durationSec: number;
}

export interface RunResult {
  won: boolean; lossWave: number; waves: WaveLog[]; finalHp: number; leaks: number; gold: number; runes: string[];
}

export interface BossProbe {
  rootedDmg: number;
  movingDmg: number;
  spawnAt: number;
  diedAt: number;
  roots: number[];
  packsSeen: number;
}

/** One full level run under a build policy. `probe` (‑‑boss) collects
 * Heartwood diagnostics: damage split rooted/moving, phase-crossing
 * times, time-to-kill. */
export function simulate(level: LevelDef, policy: Policy, seed: number, probe?: BossProbe): RunResult {
  const path: PathIndex = makePath(level.map.waypoints);
  const master = new Rng(seed);
  const varianceRng = master.fork(1); // enemy speed variance + flyer spawn picks (combat stream)
  const runeRng = master.fork(2);     // rune shuffles (rune stream)

  const state = {
    gold: level.startGold, hp: level.lanternHp, maxHp: level.lanternHp,
    waveIndex: 1, phase: 'ready' as 'ready' | 'wave' | 'rune' | 'over' | 'won',
    gameTime: 0, waveTime: 0, leaks: 0,
    enemies: [] as SimEnemy[], towers: [] as SimTower[],
    bolts: [] as SimBolt[], shells: [] as SimShell[],
    spawnQueue: [] as { kind: EnemyKind; at: number }[],
    runes: new Set<string>(),
  };
  const tiles: (SimTower | null)[] = level.map.tiles.map(() => null);

  // ---- policy execution (builds/upgrades as soon as affordable) ----
  let stepPtr = 0;
  const buildCost = (kind: TowerKind) => towerBuildCost(kind, state.runes);
  const tryPolicyStep = (): boolean => {
    const step = policy.steps[stepPtr];
    if (!step) return false;
    if ('build' in step) {
      const [tileIdx, kind] = step.build;
      if (tileIdx < 0 || tileIdx >= tiles.length || !level.towers.includes(kind)) throw new Error(`bad plan step: ${JSON.stringify(step)} (level ${level.id})`);
      if (tiles[tileIdx] || state.gold < buildCost(kind)) return false;
      state.gold -= buildCost(kind);
      const t = new SimTower(kind, tileIdx, level.map.tiles[tileIdx].x, level.map.tiles[tileIdx].y);
      tiles[tileIdx] = t;
      state.towers.push(t);
      stepPtr++;
      return true;
    }
    const t = tiles[step.up];
    const cost = (t ? towerNextCost(t, state.runes) : null);
    if (!t || cost === null || state.gold < cost) return false;
    state.gold -= cost;
    t.tier++;
    stepPtr++;
    return true;
  };

  // ---- enemy lifecycle (shared core: src/sim/enemy.ts) ----
  const spawnEnemy = (kind: EnemyKind) => {
    state.enemies.push(spawnEnemyCore(kind, state.waveIndex, level.hpMult, level.map, varianceRng));
  };

  const damage = (e: SimEnemy, amount: number, splash = false): void => {
    if (damageEnemyCore(e, amount, state.gameTime, splash)) {
      if (probe && e.kind === 'heartwood') probe.diedAt = state.gameTime;
      state.gold += killBounty(e, state.runes);
    }
    // boss probe (‑‑boss): where does Heartwood damage land — rooted or moving?
    // (post-bark-adjustment, same math as the core via splashAdjusted)
    if (probe && e.kind === 'heartwood') {
      const applied = splashAdjusted(e, amount, state.gameTime, splash);
      if (state.gameTime < e.rootUntil) probe.rootedDmg += applied;
      else probe.movingDmg += applied;
    }
  };

  /** One frame — returns true on leak. */
  const updateEnemy = (e: SimEnemy): boolean => {
    const res = stepEnemyCore(e, e, DT, state.gameTime, path, state.enemies);
    if (res.burnKilled) {
      state.gold += killBounty(e, state.runes);
      return false; // a corpse cannot leak
    }
    if (res.summonDist !== null) {
      for (const d of summonDropDists(res.summonDist, res.summonCount)) {
        spawnEnemy('runner'); // consumes combat-variance stream, like the real game
        state.enemies[state.enemies.length - 1].dist = d;
      }
    }
    return res.leaked;
  };

  // ---- towers (shared targeting/halo: src/sim/combat.ts) ----
  const acquire = (t: SimTower): SimEnemy | null => acquireTarget(t.x, t.y, towerRange(t, state.runes), state.enemies);

  // ---- combat effects (shared core: src/sim/combat.ts) ----
  const fireBeam = (t: SimTower, target: SimEnemy) => {
    const g = beamGeom(t.x, t.y, target.x, target.y, towerRange(t, state.runes));
    const width = beamWidth(t.tier, state.runes);
    for (const e of beamHits(t.x, t.y, g.end.x, g.end.y, width, state.enemies)) {
      damage(e, towerDmg(t, state.towers, state.runes));
    }
  };

  const explode = (x: number, y: number, radius: number, dmg: number) => {
    for (const e of splashHits(x, y, radius, state.enemies)) damage(e, dmg, true);
  };

  const chain = (victim: SimEnemy, dmg: number) => {
    for (const e of chainTargets(victim, state.enemies, COMBAT.chainTargets, COMBAT.chainRadius)) {
      damage(e, dmg * COMBAT.chainDamageMult);
    }
  };

  const updateTower = (t: SimTower) => {
    if (t.kind === 'grove') return; // support tower: no attack of its own
    if (t.kind === 'halo') {
      t.auraTick -= DT;
      if (t.auraTick <= 0) {
        t.auraTick = 1000 / towerRate(t, state.towers, state.runes);
        const until = state.gameTime + COMBAT.auraSlowMs;
        for (const e of auraHits(t.x, t.y, towerRange(t, state.runes), state.enemies)) {
          applySlowCore(e, towerSlow(t, state.runes), until, state.gameTime);
          if (hasSlowBurn(state.runes)) applyBurnCore(e, COMBAT.slowBurnDps, until);
          damage(e, towerDmg(t, state.towers, state.runes));
        }
      }
      return;
    }
    t.cooldown -= DT;
    if (t.cooldown > 0) return;
    const target = acquire(t);
    if (!target) return;
    t.cooldown = 1000 / towerRate(t, state.towers, state.runes);
    if (t.kind === 'ember') state.bolts.push({ x: t.x, y: t.y - 14, target, dest: { x: target.x, y: target.y }, speed: COMBAT.boltSpeed, dmg: towerDmg(t, state.towers, state.runes), dead: false });
    else if (t.kind === 'prism') fireBeam(t, target);
    else {
      // kiln shell: flight to the target's predicted position (shared lead math)
      const p = posAheadCore(target, COMBAT.shellLeadMs, state.gameTime, path);
      state.shells.push({ from: { x: t.x, y: t.y - 14 }, to: p, t: 0, dmg: towerDmg(t, state.towers, state.runes), radius: towerSplash(t, state.runes), dead: false });
    }
  };

  // ---- runes ----
  const pickRune = (offered: string[]): string => {
    for (const id of policy.runePriority) if (offered.includes(id)) return id;
    return offered[offered.length - 1];
  };
  const applyRune = (id: string) => {
    state.runes.add(id);
    const inst = runeInstants(id);
    if (inst.maxHpPlus > 0) state.maxHp += inst.maxHpPlus;
    if (inst.healToFull) state.hp = state.maxHp;
    state.gold += inst.gold;
  };

  // ---- wave flow (shared core: src/sim/waves.ts) ----
  const startWave = () => {
    state.phase = 'wave';
    state.waveTime = 0;
    // authored tables only (no RNG consumed for campaign waves)
    state.spawnQueue = buildSpawnQueue(waveGroups(level, state.waveIndex, new Rng(0)));
  };

  const result: RunResult = { won: false, lossWave: 0, waves: [], finalHp: state.hp, leaks: 0, gold: 0, runes: [] };
  let waveLeaks = 0, waveHpLost = 0, waveT0 = 0;
  const logWave = (cleared: boolean) => {
    result.waves.push({
      wave: state.waveIndex, cleared, hpAfter: state.hp, goldAfter: state.gold,
      leaks: waveLeaks, hpLost: waveHpLost, durationSec: (state.gameTime - waveT0) / 1000,
    });
    waveLeaks = 0; waveHpLost = 0;
  };

  const endWave = () => {
    const cleared = state.waveIndex;
    state.gold += waveBonus(cleared);
    logWave(true);
    state.waveIndex = cleared + 1;
    state.phase = 'ready';
    if (cleared >= level.waves.length) {
      state.phase = 'won';
      return;
    }
    if (level.runes && cleared % 5 === 0) {
      // shared offering rules (runeOfferPool): filter, shuffle, offer 3 — policy picks one
      const pool = runeOfferPool(level, state.runes).map((r) => r.id);
      const offered = runeRng.shuffle(pool).slice(0, 3);
      applyRune(pickRune(offered));
    }
  };

  // ---- main loop ----
  const tickBossProbe = () => {
    if (!probe) return;
    const b = state.enemies.find((e) => e.kind === 'heartwood');
    if (b && !probe.spawnAt) probe.spawnAt = state.gameTime;
    if (b && b.phase > probe.roots.length) probe.roots.push(state.gameTime);
    if (b && probe.packsSeen < b.phase) probe.packsSeen = b.phase;
    if (!b && probe.spawnAt && !probe.diedAt) probe.diedAt = state.gameTime;
  };
  const FRAMES_MAX = 60 * 60 * 40; // 40 min game-time safety cap
  let frames = 0;
  while (state.phase !== 'won' && state.phase !== 'over' && frames < FRAMES_MAX) {
    frames++;
    if (state.phase === 'ready') {
      while (tryPolicyStep()); // build as much of the plan as gold allows, then start
      startWave();
      waveT0 = state.gameTime;
      continue;
    }
    state.gameTime += DT;
    if (state.phase === 'wave') {
      state.waveTime += DT;
      while (state.spawnQueue.length && state.spawnQueue[0].at <= state.waveTime) {
        spawnEnemy(state.spawnQueue.shift()!.kind);
      }
    }
    while (tryPolicyStep()); // mid-wave builds/upgrades when affordable
    tickBossProbe();

    for (const e of state.enemies) {
      if (!e.alive) continue;
      if (updateEnemy(e)) { // leak
        state.leaks++;
        waveLeaks++;
        const before = state.hp;
        state.hp = leakDamage(state.hp, e.kind);
        waveHpLost += before - state.hp;
        if (state.hp <= 0) {
          state.phase = 'over';
          logWave(false);
        }
      }
    }
    state.enemies = state.enemies.filter((e) => e.alive);
    for (const t of state.towers) updateTower(t);

    for (const b of state.bolts) {
      if (stepBoltCore(b, DT)) {
        if (b.target && b.target.alive) {
          damage(b.target, b.dmg);
          if (hasChains(state.runes)) chain(b.target, b.dmg); // chains whether or not the hit killed
        }
        b.dead = true;
      }
    }
    state.bolts = state.bolts.filter((b) => !b.dead);

    for (const s of state.shells) {
      if (stepShellCore(s, DT, COMBAT.shellLeadMs) >= 1) {
        explode(s.to.x, s.to.y, s.radius, s.dmg);
        s.dead = true;
      }
    }
    state.shells = state.shells.filter((s) => !s.dead);

    if (state.phase === 'wave' && state.spawnQueue.length === 0 && state.enemies.length === 0) endWave();
  }
  if (frames >= FRAMES_MAX) state.phase = 'over';

  result.won = state.phase === 'won';
  result.lossWave = result.won ? level.waves.length : state.waveIndex;
  result.finalHp = state.hp;
  result.leaks = state.leaks;
  result.gold = state.gold;
  result.runes = [...state.runes];
  return result;
}

// ---------- tile coverage analysis (policy design aid) ----------
export function coverage(level: LevelDef): string[] {
  const path = makePath(level.map.waypoints);
  const pathSamples: Pt[] = [];
  for (let d = 0; d <= path.len; d += 8) pathSamples.push(path.posAt(d));
  const lanes: Pt[][] = level.map.flyerSpawns.map((f) => {
    const pts: Pt[] = [];
    const L = dist(f.x, f.y, level.map.lantern.x, level.map.lantern.y);
    for (let d = 0; d <= L; d += 8) {
      const t = d / L;
      pts.push({ x: f.x + (level.map.lantern.x - f.x) * t, y: f.y + (level.map.lantern.y - f.y) * t });
    }
    return pts;
  });
  const lines: string[] = [];
  const ranges = level.towers.map((k) => ({ k, r: TOWERS[k].tiers[0].range }));
  lines.push(`LEVEL ${level.id} — ${level.name}: path ${Math.round(path.len)}px, ${level.map.tiles.length} tiles`);
  const header = 'tile  x,y        ' + ranges.map(({ k }) => `${k.padEnd(6)}(path/fly)`).join('  ');
  lines.push(header);
  level.map.tiles.forEach((t, i) => {
    const cells = ranges.map(({ r }) => {
      const p = pathSamples.filter((s) => dist(s.x, s.y, t.x, t.y) <= r).length / pathSamples.length;
      const f = lanes.every((lane) => lane.every((s) => dist(s.x, s.y, t.x, t.y) > r))
        ? 0 // no lane touched
        : Math.max(...lanes.map((lane) => lane.filter((s) => dist(s.x, s.y, t.x, t.y) <= r).length / lane.length));
      return `${(Math.round(p * 100) + '%').padStart(4)}/${(Math.round(f * 100) + '%').padStart(3)}`;
    });
    lines.push(`${String(i).padStart(3)}   ${String(t.x).padStart(3)},${String(t.y).padStart(4)}    ` + cells.map((c, j) => `${c} ${ranges[j].k.slice(0, 5).padEnd(6)}`).join('  '));
  });
  return lines;
}

// ---------- CLI ----------
const argv = process.argv.slice(2);
const arg = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};

export function main(): void {
  if (argv.includes('--coverage')) {
    for (const lvl of LEVELS) console.log(coverage(lvl).join('\n'), '\n');
    return;
  }
  const levelIds = arg('level') ? [Number(arg('level'))] : LEVELS.map((l) => l.id);
  const policyFilter = arg('policy');
  const seeds = Number(arg('seeds') ?? 30);
  const verbose = argv.includes('--waves');

  for (const id of levelIds) {
    const level = LEVELS[id - 1];
    for (const policy of POLICIES.filter((p) => p.level === id && (!policyFilter || p.name === policyFilter))) {
      const runs: RunResult[] = [];
      const bossProbes = argv.includes('--boss') ? [] : null;
      for (let s = 1; s <= seeds; s++) {
        const probe = bossProbes ? { rootedDmg: 0, movingDmg: 0, spawnAt: 0, diedAt: 0, roots: [] as number[], packsSeen: 0 } : undefined;
        runs.push(simulate(level, policy, s * 7919 + 13, probe));
        if (probe) bossProbes.push(probe);
      }
      const wins = runs.filter((r) => r.won);
      const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
      console.log(`\nL${id} "${policy.name}" (${policy.desc}) — ${seeds} seeds`);
      console.log(`  win ${(wins.length / runs.length * 100).toFixed(0)}% | loss wave avg ${avg(runs.filter(r => !r.won).map(r => r.lossWave)).toFixed(1)} | final hp ${avg(runs.map(r => r.finalHp)).toFixed(1)}/${level.lanternHp} (min ${Math.min(...runs.map(r => r.finalHp))}) | leaks ${avg(runs.map(r => r.leaks)).toFixed(1)} | gold left ${avg(runs.map(r => r.gold)).toFixed(0)}`);
      if (bossProbes && bossProbes.length && bossProbes.some((p) => p.spawnAt)) {
        const R = (f: (p: BossProbe) => number) => avg(bossProbes.filter((p) => p.spawnAt).map(f));
        const rooted = R((p) => p.rootedDmg);
        const moving = R((p) => p.movingDmg);
        const ttk = avg(bossProbes.filter((p) => p.diedAt > p.spawnAt).map((p) => (p.diedAt - p.spawnAt) / 1000));
        console.log(`  BOSS: dmg while ROOTED ${Math.round(rooted)} vs MOVING ${Math.round(moving)} (${Math.round((rooted / Math.max(1, rooted + moving)) * 100)}% rooted) | TTK ${ttk.toFixed(1)}s | roots at ${[0, 1, 2].map((i) => R((p) => (p.roots[i] ?? NaN) - p.spawnAt).toFixed(0)).join('/')}s after spawn | phases crossed ${R((p) => p.packsSeen).toFixed(1)}/3`);
      }
      if (verbose) {
        const waveCount = Math.max(...runs.map((r) => r.waves.length));
        console.log('  wave | avgLeak maxLeak 0leak% | avgHp minHp | avgGold');
        for (let w = 1; w <= waveCount; w++) {
          const rows = runs.map((r) => r.waves.find((x) => x.wave === w)).filter((x): x is WaveLog => Boolean(x));
          if (!rows.length) continue;
          const zero = rows.filter((r) => r.leaks === 0).length / rows.length;
          console.log(
            `  ${String(w).padStart(4)} | ${avg(rows.map(r => r.leaks)).toFixed(2).padStart(7)} ${String(Math.max(...rows.map(r => r.leaks))).padStart(7)} ${(Math.round(zero * 100) + '%').padStart(6)} | ${avg(rows.map(r => r.hpAfter)).toFixed(1).padStart(5)} ${String(Math.min(...rows.map(r => r.hpAfter))).padStart(5)} | ${avg(rows.map(r => r.goldAfter)).toFixed(0).padStart(5)}`,
          );
        }
      }
      const minLeaks = Math.min(...runs.map((r) => r.leaks));
      console.log(`  min leaks across seeds: ${minLeaks} | perfect-run rate: ${runs.filter(r => r.leaks === 0 && r.won).length}/${runs.length}`);
    }
  }
}
