// Headless balance simulator — mirrors GameScene.update()'s loop semantics
// frame-for-frame at 60fps, driving the REAL data from src/config.ts (via
// the phaser shim alias) and the REAL rune modifiers from src/runes.ts.
//
// FIDELITY CONTRACT (update this file when the mirrored code changes):
//   - spawn order & timing: scripts/cdp-smoke.mjs enemies ← GameScene.update
//   - movement/slow/burn/heal: Enemy.update (armor min-1 rule included)
//   - targeting: Tower.acquire (min `remaining` within range²)
//   - firing: Tower.update (halo aura pulse / ember bolt / prism beam / kiln shell)
//   - projectiles: GameScene.update bolts (homing, arrive radius) & shells
//     (fixed 750ms to lead position, splash + grace)
//   - economy: kill bounty, waveBonus at endWave, startGold/lanternHp
//   - runes: pickRunes filter+shuffle, applyRune effects
// NOT modeled: visuals, audio, sell/reposition, prep idle time (waves start
// instantly — no gameplay time passes between waves anyway).
import {
  COMBAT, ENEMIES, EnemyKind, LEVELS, LevelDef, PathIndex, Pt, RUNES, SpawnGroup, TowerKind, TOWERS,
  BOSS_LIKES, makePath, waveBonus, waveGroups,
} from '../src/config';
import { Rng } from '../src/rng';
import { RuneId } from '../src/runes-ids';
import {
  bountyMult, costMult, hasChains, hasSlowBurn, prismDmgMult, rangeMult, rateMult, slowMult,
  splashMult, emberRateMult, beamWidthMult, kilnDmgMult, groveRangeMult, groveGainMult,
} from '../src/runes';
import { POLICIES, Policy } from './sim-policies';

const DT = 1000 / 60; // fixed-step frames (game caps delta at 100ms; 60fps is the device norm)

interface SimEnemy {
  kind: EnemyKind; hp: number; maxHp: number; speed: number; armor: number; bounty: number;
  alive: boolean; isBoss: boolean; summonTick: number;
  dist: number; flyFrom: Pt | null; flyTo: Pt; flyT: number; flyLen: number;
  slowFactor: number; slowUntil: number; burnDps: number; burnUntil: number; burnTick: number;
  healTick: number; x: number; y: number; remaining: number;
}

class SimTower {
  tier = 0;
  cooldown = 0;
  auraTick = 0;
  constructor(readonly kind: TowerKind, readonly tileIndex: number, readonly x: number, readonly y: number) {}
  // effective stats — mirror Tower getters (runes + grove buffs applied)
  range(runes: Set<string>): number {
    const r = TOWERS[this.kind].tiers[this.tier].range * rangeMult(runes);
    return this.kind === 'grove' ? r * groveRangeMult(runes) : r;
  }
  rate(runes: Set<string>, towers: SimTower[]): number {
    let r = TOWERS[this.kind].tiers[this.tier].rate * rateMult(runes) * groveBuff(towers, this, runes).rate;
    if (this.kind === 'ember') r *= emberRateMult(runes);
    return r;
  }
  dmg(runes: Set<string>, towers: SimTower[]): number {
    const base = TOWERS[this.kind].tiers[this.tier].dmg;
    const g = groveBuff(towers, this, runes).dmg;
    if (this.kind === 'prism') return base * prismDmgMult(runes) * g;
    if (this.kind === 'kiln') return base * kilnDmgMult(runes) * g;
    return base * g;
  }
  splash(runes: Set<string>): number { return (TOWERS[this.kind].tiers[this.tier].splash ?? 0) * splashMult(runes); }
  slow(runes: Set<string>): number { return (TOWERS[this.kind].tiers[this.tier].slow ?? 0.6) * slowMult(runes); }
  nextCost(runes: Set<string>): number | null {
    if (this.tier >= 2) return null;
    return Math.round(TOWERS[this.kind].tiers[this.tier + 1].cost * costMult(runes));
  }
}

/** Product of covering Wisp Grove buffs (mirror GameScene.groveBuffFor,
 * including the Old Growth gain scaling). */
function groveBuff(towers: SimTower[], tower: SimTower, runes: Set<string>): { dmg: number; rate: number } {
  let dmg = 1, rate = 1;
  const gain = groveGainMult(runes);
  for (const g of towers) {
    if (g.kind !== 'grove') continue;
    const r = g.range(runes);
    if ((g.x - tower.x) ** 2 + (g.y - tower.y) ** 2 > r * r) continue;
    const buff = TOWERS.grove.tiers[g.tier].buff ?? { dmg: 1, rate: 1 };
    dmg *= 1 + (buff.dmg - 1) * gain;
    rate *= 1 + (buff.rate - 1) * gain;
  }
  return { dmg, rate };
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

const dist2 = (ax: number, ay: number, bx: number, by: number) => (ax - bx) ** 2 + (ay - by) ** 2;
const dist = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, ay - by);

function distToSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  if (l2 === 0) return dist(px, py, ax, ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / l2;
  t = Math.min(1, Math.max(0, t));
  return dist(px, py, ax + t * dx, ay + t * dy);
}

/** One full level run under a build policy. */
export function simulate(level: LevelDef, policy: Policy, seed: number): RunResult {
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
  const buildCost = (kind: TowerKind) => Math.round(TOWERS[kind].tiers[0].cost * costMult(state.runes));
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
    const cost = t?.nextCost(state.runes) ?? null;
    if (!t || cost === null || state.gold < cost) return false;
    state.gold -= cost;
    t.tier++;
    stepPtr++;
    return true;
  };

  // ---- enemy lifecycle ----
  const spawnEnemy = (kind: EnemyKind) => {
    const def = ENEMIES[kind];
    const scale = BOSS_LIKES.has(kind)
      ? 1 + COMBAT.bossHpRamp * (state.waveIndex - COMBAT.bossHpAnchorWave)
      : 1 + 0.22 * (state.waveIndex - 1) + 0.02 * (state.waveIndex - 1) ** 2;
    const speed = def.speed * varianceRng.float(COMBAT.varianceMin, COMBAT.varianceMax);
    varianceRng.float(0.92, 1.08); // sprite scale variance (visual, consume anyway)
    const e: SimEnemy = {
      kind, hp: Math.round(def.hp * scale * level.hpMult), maxHp: Math.round(def.hp * scale * level.hpMult),
      speed, armor: def.armor + Math.floor(state.waveIndex / COMBAT.armorPerWaves), bounty: def.bounty,
      alive: true, isBoss: BOSS_LIKES.has(kind), summonTick: 0,
      dist: 0, flyFrom: null, flyTo: { x: 0, y: 0 }, flyT: 0, flyLen: 1,
      slowFactor: 1, slowUntil: 0, burnDps: 0, burnUntil: 0, burnTick: 0, healTick: 0,
      x: 0, y: 0, remaining: 0,
    };
    if (kind === 'flyer') {
      const from = varianceRng.pick(level.map.flyerSpawns);
      e.flyFrom = from;
      e.flyTo = level.map.lantern;
      e.flyLen = dist(from.x, from.y, e.flyTo.x, e.flyTo.y);
      e.x = from.x; e.y = from.y;
    }
    state.enemies.push(e);
  };

  const applySlow = (e: SimEnemy, factor: number, until: number) => {
    if (factor < e.slowFactor || state.gameTime >= e.slowUntil) e.slowFactor = factor;
    e.slowUntil = Math.max(e.slowUntil, until);
  };
  const damage = (e: SimEnemy, amount: number): void => {
    e.hp -= Math.max(1, amount - e.armor);
    if (e.hp <= 0 && e.alive) {
      e.alive = false;
      state.gold += Math.round(e.bounty * bountyMult(state.runes));
    }
  };

  const updateEnemy = (e: SimEnemy): boolean => {
    const slowed = state.gameTime < e.slowUntil ? e.slowFactor : 1;
    const v = (e.speed * slowed * DT) / 1000;
    if (e.flyFrom) {
      e.flyT += v / e.flyLen;
      e.x = e.flyFrom.x + (e.flyTo.x - e.flyFrom.x) * e.flyT;
      e.y = e.flyFrom.y + (e.flyTo.y - e.flyFrom.y) * e.flyT;
      e.remaining = (1 - e.flyT) * e.flyLen;
    } else {
      e.dist += v;
      const p = path.posAt(e.dist);
      e.x = p.x; e.y = p.y;
      e.remaining = path.len - e.dist;
    }    // burn (armor-ignoring) — kills return early: a corpse cannot leak (Enemy.update)
    if (state.gameTime < e.burnUntil && e.burnDps > 0) {
      e.burnTick += DT;
      if (e.burnTick >= 250) {
        e.hp -= (e.burnDps * e.burnTick) / 1000;
        e.burnTick = 0;
        if (e.hp <= 0 && e.alive) {
          e.alive = false;
          state.gold += Math.round(e.bounty * bountyMult(state.runes));
          return false;
        }
      }
    }
    // healer aura: 2.5% max HP to neighbours (not self), twice a second
    if (e.kind === 'healer') {
      e.healTick += DT;
      if (e.healTick >= COMBAT.healerTickMs) {
        e.healTick = 0;
        for (const o of state.enemies) {
          if (o === e || !o.alive || o.hp >= o.maxHp) continue;
          if (dist(e.x, e.y, o.x, o.y) < COMBAT.healerRadius) o.hp = Math.min(o.maxHp, o.hp + o.maxHp * COMBAT.healerHealPct);
        }
      }
    }
    // the Heartwood Murk calls a runner pack from behind itself (GameScene.summonPack)
    if (e.kind === 'heartwood') {
      e.summonTick += DT;
      if (e.summonTick >= COMBAT.summonEveryMs) {
        e.summonTick = 0;
        for (let i = 0; i < COMBAT.summonCount; i++) {
          spawnEnemy('runner'); // consumes combat-variance stream, like the real game
          state.enemies[state.enemies.length - 1].dist = Math.max(0, e.dist - COMBAT.summonTrailPx * (i + 1));
        }
      }
    }
    if (e.remaining <= 0) { e.alive = false; return true; } // leak
    return false;
  };

  // ---- towers (mirror Tower.update) ----
  const acquire = (t: SimTower): SimEnemy | null => {
    let best: SimEnemy | null = null;
    const r2 = t.range(state.runes) ** 2;
    for (const e of state.enemies) {
      if (!e.alive) continue;
      if (dist2(e.x, e.y, t.x, t.y) > r2) continue;
      if (!best || e.remaining < best.remaining) best = e;
    }
    return best;
  };

  const fireBeam = (t: SimTower, target: SimEnemy) => {
    const ang = Math.atan2(target.y - t.y, target.x - t.x);
    const len = t.range(state.runes) * 1.25;
    const bx = t.x + Math.cos(ang) * len, by = t.y + Math.sin(ang) * len;
    const width = (COMBAT.beamWidthBase + t.tier * COMBAT.beamWidthPerTier) * beamWidthMult(state.runes);
    for (const e of state.enemies) {
      if (!e.alive) continue;
      if (distToSeg(e.x, e.y, t.x, t.y, bx, by) < width + 12) damage(e, t.dmg(state.runes, state.towers));
    }
  };

  const explode = (x: number, y: number, radius: number, dmg: number) => {
    for (const e of state.enemies) {
      if (!e.alive) continue;
      if (dist(x, y, e.x, e.y) <= radius + COMBAT.splashGrace) damage(e, dmg);
    }
  };

  const chain = (victim: SimEnemy, dmg: number) => {
    const near = state.enemies
      .filter((e) => e.alive && e !== victim)
      .sort((a, b) => dist(a.x, a.y, victim.x, victim.y) - dist(b.x, b.y, victim.x, victim.y));
    let chained = 0;
    for (const e of near) {
      if (chained >= COMBAT.chainTargets) break;
      if (dist(e.x, e.y, victim.x, victim.y) > COMBAT.chainRadius) continue;
      damage(e, dmg * COMBAT.chainDamageMult);
      chained++;
    }
  };

  const updateTower = (t: SimTower) => {
    if (t.kind === 'grove') return; // support tower: no attack of its own
    if (t.kind === 'halo') {
      t.auraTick -= DT;
      if (t.auraTick <= 0) {
        t.auraTick = 1000 / t.rate(state.runes, state.towers);
        const until = state.gameTime + COMBAT.auraSlowMs;
        const r2 = t.range(state.runes) ** 2;
        for (const e of state.enemies) {
          if (!e.alive) continue;
          if (dist2(e.x, e.y, t.x, t.y) > r2) continue;
          applySlow(e, t.slow(state.runes), until);
          if (hasSlowBurn(state.runes)) {
            e.burnDps = Math.max(e.burnDps, COMBAT.slowBurnDps);
            e.burnUntil = Math.max(e.burnUntil, until);
          }
          damage(e, t.dmg(state.runes, state.towers));
        }
      }
      return;
    }
    t.cooldown -= DT;
    if (t.cooldown > 0) return;
    const target = acquire(t);
    if (!target) return;
    t.cooldown = 1000 / t.rate(state.runes, state.towers);
    if (t.kind === 'ember') state.bolts.push({ x: t.x, y: t.y - 14, target, dest: { x: target.x, y: target.y }, speed: COMBAT.boltSpeed, dmg: t.dmg(state.runes, state.towers), dead: false });
    else if (t.kind === 'prism') fireBeam(t, target);
    else {
      // kiln shell: 750ms flight to the target's predicted position
      const lead = COMBAT.shellLeadMs;
      const v = target.speed * (state.gameTime < target.slowUntil ? target.slowFactor : 1);
      const aheadDist = Math.min(target.remaining, (v * lead) / 1000);
      const p = target.flyFrom
        ? (() => {
            const ft = Math.min(1, Math.max(0, target.flyT + aheadDist / target.flyLen));
            return { x: target.flyFrom.x + (target.flyTo.x - target.flyFrom.x) * ft, y: target.flyFrom.y + (target.flyTo.y - target.flyFrom.y) * ft };
          })()
        : path.posAt(path.len - target.remaining + aheadDist);
      state.shells.push({ from: { x: t.x, y: t.y - 14 }, to: p, t: 0, dmg: t.dmg(state.runes, state.towers), radius: t.splash(state.runes), dead: false });
    }
  };

  // ---- runes ----
  const pickRune = (offered: string[]): string => {
    for (const id of policy.runePriority) if (offered.includes(id)) return id;
    return offered[offered.length - 1];
  };
  const applyRune = (id: string) => {
    state.runes.add(id);
    if (id === RuneId.sturdy) { state.maxHp += 8; state.hp = state.maxHp; }
    if (id === RuneId.fortune) state.gold += 80;
  };

  // ---- wave flow ----
  const startWave = () => {
    state.phase = 'wave';
    state.waveTime = 0;
    state.spawnQueue = [];
    const groups: SpawnGroup[] = waveGroups(level, state.waveIndex, new Rng(0)); // authored tables only
    for (const grp of groups) {
      for (let i = 0; i < grp.count; i++) state.spawnQueue.push({ kind: grp.kind, at: (grp.delay + i * grp.gap) * 1000 });
    }
    state.spawnQueue.sort((a, b) => a.at - b.at);
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
      // mirror pickRunes: real RUNES table, filter, shuffle, offer 3 — policy picks one
      const owned = new Set(state.runes);
      const pool = RUNES.filter(
        (r) =>
          (!r.tower || level.towers.includes(r.tower)) &&
          (!owned.has(r.id) || r.id === RuneId.fortune),
      ).map((r) => r.id);
      const offered = runeRng.shuffle(pool).slice(0, 3);
      applyRune(pickRune(offered));
    }
  };

  // ---- main loop ----
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

    for (const e of state.enemies) {
      if (!e.alive) continue;
      if (updateEnemy(e)) { // leak
        state.leaks++;
        waveLeaks++;
        const dmg = ENEMIES[e.kind].leak;
        state.hp = Math.max(0, state.hp - dmg);
        waveHpLost += dmg;
        if (state.hp <= 0) {
          state.phase = 'over';
          logWave(false);
        }
      }
    }
    state.enemies = state.enemies.filter((e) => e.alive);
    for (const t of state.towers) updateTower(t);

    for (const b of state.bolts) {
      if (b.target && b.target.alive) b.dest = { x: b.target.x, y: b.target.y };
      const d = dist(b.dest.x, b.dest.y, b.x, b.y);
      const step = (b.speed * DT) / 1000;
      if (d <= step + 10) {
        if (b.target && b.target.alive) {
          damage(b.target, b.dmg);
          if (hasChains(state.runes)) chain(b.target, b.dmg); // chains whether or not the hit killed
        }
        b.dead = true;
      } else {
        b.x += ((b.dest.x - b.x) / d) * step;
        b.y += ((b.dest.y - b.y) / d) * step;
      }
    }
    state.bolts = state.bolts.filter((b) => !b.dead);

    for (const s of state.shells) {
      s.t += DT;
      if (s.t >= COMBAT.shellLeadMs) {
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
      for (let s = 1; s <= seeds; s++) runs.push(simulate(level, policy, s * 7919 + 13));
      const wins = runs.filter((r) => r.won);
      const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
      console.log(`\nL${id} "${policy.name}" (${policy.desc}) — ${seeds} seeds`);
      console.log(`  win ${(wins.length / runs.length * 100).toFixed(0)}% | loss wave avg ${avg(runs.filter(r => !r.won).map(r => r.lossWave)).toFixed(1)} | final hp ${avg(runs.map(r => r.finalHp)).toFixed(1)}/${level.lanternHp} (min ${Math.min(...runs.map(r => r.finalHp))}) | leaks ${avg(runs.map(r => r.leaks)).toFixed(1)} | gold left ${avg(runs.map(r => r.gold)).toFixed(0)}`);
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
