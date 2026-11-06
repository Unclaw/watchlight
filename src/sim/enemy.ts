// Shared enemy core — Phaser-free. Enemy state, spawning (rng consumption
// order is part of the daily-seed contract), per-frame stepping (movement,
// burn, healer aura, Heartwood summons, leak) and damage/heal math live
// HERE once. The game's Enemy entity wraps an EnemyCore (getters + visuals);
// the balance simulator uses the core directly.
import { BOSS_LIKES, COMBAT, ENEMIES, EnemyKind, PathIndex, Pt, waveScale } from '../config';
import type { Rng } from '../rng';
import { bountyMult } from '../runes';
import { dist } from './geom';

/** Full combat-relevant enemy state. */
export interface EnemyCore {
  kind: EnemyKind;
  hp: number;
  maxHp: number;
  speed: number;
  armor: number;
  bounty: number;
  alive: boolean;
  /** Sprite scale variance — visual only, but consumed from the combat
   * stream so game and sim draws stay identical (kept in the core for
   * stream parity, not gameplay). */
  variance: number;
  dist: number; // ground progress (px along path)
  flyFrom: Pt | null;
  flyTo: Pt;
  flyT: number;
  flyLen: number;
  slowFactor: number;
  slowUntil: number;
  burnDps: number;
  burnUntil: number;
  burnTick: number;
  healTick: number;
  /** Heartwood Root & Sprout: thresholds crossed so far + rooted-until
   * timestamp (0 for everything else). */
  phase: number;
  rootUntil: number;
  x: number;
  y: number;
  /** px remaining to the Lantern — targeting sort key (smaller = more urgent). */
  remaining: number;
}

/** What a step did — the wrapper/sim translate these into visuals, bounties
 * and lantern damage. burnKilled short-circuits: a corpse cannot leak. */
export interface EnemyStepResult {
  leaked: boolean;
  burnKilled: boolean;
  /** Heartwood crossed a threshold: caller sprouts `summonCount` runners
   * behind this path distance (the rooted burst window opens too). */
  summonDist: number | null;
  summonCount: number;
}

/** Peer view for the healer aura (any object exposing enemy hp state). */
export interface HealPeer {
  hp: number;
  maxHp: number;
  alive: boolean;
  x: number;
  y: number;
}

export function isBossKind(kind: EnemyKind): boolean {
  return BOSS_LIKES.has(kind);
}

export interface SpawnMap {
  flyerSpawns: Pt[];
  lantern: Pt;
}

/**
 * Deterministic enemy spawn. Rng consumption order is CONTRACTUAL (daily
 * seeds): speed variance float, sprite-scale float, then the flyer spawn
 * pick for flyers.
 */
export function spawnEnemyCore(kind: EnemyKind, wave: number, hpMult: number, map: SpawnMap, rng: Rng): EnemyCore {
  const def = ENEMIES[kind];
  const scale = isBossKind(kind)
    ? 1 + COMBAT.bossHpRamp * (wave - COMBAT.bossHpAnchorWave)
    : waveScale(wave); // config math, never inline it (DEV_NOTES §7)
  const hp = Math.round(def.hp * scale * hpMult);
  const e: EnemyCore = {
    kind,
    hp,
    maxHp: hp,
    speed: def.speed * rng.float(COMBAT.varianceMin, COMBAT.varianceMax),
    armor: def.armor + Math.floor(wave / COMBAT.armorPerWaves),
    bounty: def.bounty,
    alive: true,
    variance: rng.float(0.92, 1.08),
    dist: 0,
    flyFrom: null,
    flyTo: { x: 0, y: 0 },
    flyT: 0,
    flyLen: 1,
    slowFactor: 1,
    slowUntil: 0,
    burnDps: 0,
    burnUntil: 0,
    burnTick: 0,
    healTick: 0,
    phase: 0,
    rootUntil: 0,
    x: 0,
    y: 0,
    remaining: 0,
  };
  if (kind === 'flyer') {
    const from = rng.pick(map.flyerSpawns);
    e.flyFrom = from;
    e.flyTo = map.lantern;
    e.flyLen = dist(from.x, from.y, map.lantern.x, map.lantern.y);
    e.x = from.x;
    e.y = from.y;
  }
  return e;
}

/**
 * Advance one enemy one frame. `self` is this enemy's own peer-view (the
 * game passes the Enemy wrapper, the sim passes the core) so the healer
 * aura can skip itself exactly like the original code. Positions are the
 * LINEAR path/flyer math; the game applies its flyer dip on top (visual,
 * but baked into y so targeting sees it — sim deliberately models none).
 */
export function stepEnemyCore<P extends HealPeer>(
  e: EnemyCore,
  self: P,
  dtMs: number,
  now: number,
  path: PathIndex,
  peers: readonly P[],
  onHeal?: (peer: P) => void,
  res: EnemyStepResult = { leaked: false, burnKilled: false, summonDist: null, summonCount: 0 },
): EnemyStepResult {
  res.leaked = false;
  res.burnKilled = false;
  res.summonDist = null;
  res.summonCount = 0;
  const rooted = now < e.rootUntil; // Root & Sprout: full stop (burn still ticks!)
  const crawl = e.kind === 'heartwood' ? COMBAT.heartwoodPhaseSpeed ** e.phase : 1;
  const slowed = now < e.slowUntil ? e.slowFactor : 1;
  const v = rooted ? 0 : (e.speed * slowed * crawl * dtMs) / 1000;
  if (e.flyFrom) {
    e.flyT += v / e.flyLen;
    e.x = e.flyFrom.x + (e.flyTo.x - e.flyFrom.x) * e.flyT;
    e.y = e.flyFrom.y + (e.flyTo.y - e.flyFrom.y) * e.flyT;
    e.remaining = (1 - e.flyT) * e.flyLen;
  } else {
    e.dist += v;
    const p = path.posAt(e.dist);
    e.x = p.x;
    e.y = p.y;
    e.remaining = path.len - e.dist;
  }

  // burn ticks (armor-ignoring) — a corpse cannot leak: stop here
  if (now < e.burnUntil && e.burnDps > 0) {
    e.burnTick += dtMs;
    if (e.burnTick >= 250) {
      e.hp -= (e.burnDps * e.burnTick) / 1000;
      e.burnTick = 0;
      if (e.hp <= 0 && e.alive) {
        e.alive = false;
        res.burnKilled = true;
        return res;
      }
    }
  }

  // healer aura: 2.5% max HP to neighbours (not self), twice a second
  if (e.kind === 'healer') {
    e.healTick += dtMs;
    if (e.healTick >= COMBAT.healerTickMs) {
      e.healTick = 0;
      for (const o of peers) {
        if (o === self || !o.alive || o.hp >= o.maxHp) continue;
        if (dist(e.x, e.y, o.x, o.y) < COMBAT.healerRadius) {
          o.hp = Math.min(o.maxHp, o.hp + o.maxHp * COMBAT.healerHealPct);
          onHeal?.(o);
        }
      }
    }
  }

  // the Heartwood Murk — Root & Sprout: thresholds, not timers
  if (e.kind === 'heartwood') {
    const next = COMBAT.heartwoodPhases[e.phase];
    if (next !== undefined && e.hp / e.maxHp <= next) {
      e.phase++;
      e.rootUntil = now + COMBAT.heartwoodRootMs;
      res.summonDist = e.dist;
      res.summonCount = COMBAT.heartwoodPack[e.phase - 1];
    }
  }

  if (e.remaining <= 0) {
    e.alive = false;
    res.leaked = true;
  }
  return res;
}

/** Splash hits against a ROOTED Heartwood are scaled by
 * heartwoodRootSplashMult — bark hardens while it stands (beams/sparks
 * pierce at full value: the focus-fire window). One source of truth for
 * combat AND the sim's boss probe. */
export function splashAdjusted(e: EnemyCore, amount: number, now = 0, splash = false): number {
  return splash && e.kind === 'heartwood' && now < e.rootUntil
    ? amount * COMBAT.heartwoodRootSplashMult
    : amount;
}

/** Armor-respecting hit; returns true if THIS hit killed the creature
 * (kills are idempotent — a corpse cannot die again). */
export function damageEnemyCore(e: EnemyCore, amount: number, now = 0, splash = false): boolean {
  e.hp -= Math.max(1, splashAdjusted(e, amount, now, splash) - e.armor);
  if (e.hp <= 0 && e.alive) {
    e.alive = false;
    return true;
  }
  return false;
}

/** Kill bounty (runes can boost it). */
export function killBounty(e: EnemyCore, runes: ReadonlySet<string>): number {
  return Math.round(e.bounty * bountyMult(runes));
}

/** Stronger slow wins, or any slow once the current one has expired
 * (`now`-anchored, matching the original game/sim logic). */
export function applySlowCore(e: EnemyCore, factor: number, until: number, now: number): void {
  if (factor < e.slowFactor || now >= e.slowUntil) e.slowFactor = factor;
  e.slowUntil = Math.max(e.slowUntil, until);
}

export function applyBurnCore(e: EnemyCore, dps: number, until: number): void {
  e.burnDps = Math.max(e.burnDps, dps);
  e.burnUntil = Math.max(e.burnUntil, until);
}

export function healCore(e: EnemyCore, amount: number): void {
  e.hp = Math.min(e.maxHp, e.hp + amount);
}

/** Predicted position ~ms in the future (mortar shell lead). Linear path —
 * no flyer dip, same as it ever was on both sides. */
export function posAheadCore(e: EnemyCore, ms: number, now: number, path: PathIndex): Pt {
  const v = e.speed * (now < e.slowUntil ? e.slowFactor : 1);
  const lead = Math.min(e.remaining, (v * ms) / 1000);
  if (e.flyFrom) {
    const t = Math.min(1, Math.max(0, e.flyT + lead / e.flyLen));
    return {
      x: e.flyFrom.x + (e.flyTo.x - e.flyFrom.x) * t,
      y: e.flyFrom.y + (e.flyTo.y - e.flyFrom.y) * t,
    };
  }
  return path.posAt(path.len - e.remaining + lead);
}

/** Path distances for a sprouted runner pack (trailing behind the boss). */
export function summonDropDists(bossDist: number, count: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    out.push(Math.max(0, bossDist - COMBAT.summonTrailPx * (i + 1)));
  }
  return out;
}
