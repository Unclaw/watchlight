// Shared combat core — Phaser-free. Targeting (closest-to-Lantern), prism
// beam geometry + hits, kiln splash & ember chain resolution, bolt homing
// and shell flight all live HERE once for game and simulator.
// Cadence accumulators (cooldown/auraTick: decrement, reset on fire) are
// deliberately left to the callers — the fire-clock pattern is trivial and
// welded into kind dispatch; the drift risk lives in the math below.
import { COMBAT, Pt } from '../config';
import { beamWidthMult } from '../runes';
import { dist, dist2, distToSeg } from './geom';

/** Anything targetable/hittable by tower fire. */
export interface Targetable {
  alive: boolean;
  x: number;
  y: number;
  /** px remaining to the Lantern — smaller = more urgent. */
  remaining: number;
}

/** Pick the foe closest to the Lantern within range (Tower.acquire). */
export function acquireTarget<E extends Targetable>(
  x: number,
  y: number,
  range: number,
  enemies: readonly E[],
): E | null {
  let best: E | null = null;
  const r2 = range * range;
  for (const e of enemies) {
    if (!e.alive) continue;
    if (dist2(e.x, e.y, x, y) > r2) continue;
    if (!best || e.remaining < best.remaining) best = e;
  }
  return best;
}

/** Every alive foe within range (halo aura pulse). */
export function auraHits<E extends Targetable>(x: number, y: number, range: number, enemies: readonly E[]): E[] {
  const out: E[] = [];
  const r2 = range * range;
  for (const e of enemies) {
    if (!e.alive) continue;
    if (dist2(e.x, e.y, x, y) > r2) continue;
    out.push(e);
  }
  return out;
}

export interface BeamGeom {
  end: Pt;
  ang: number;
  len: number;
}

/** Prism beam ray: from the tower through the target, 1.25× range long. */
export function beamGeom(x: number, y: number, tx: number, ty: number, range: number): BeamGeom {
  const ang = Math.atan2(ty - y, tx - x);
  const len = range * 1.25;
  return { end: { x: x + Math.cos(ang) * len, y: y + Math.sin(ang) * len }, ang, len };
}

/** Prism beam width (tier-scaled, rune-widened). */
export function beamWidth(tier: number, runes: ReadonlySet<string>): number {
  return (COMBAT.beamWidthBase + tier * COMBAT.beamWidthPerTier) * beamWidthMult(runes);
}

/** Foes struck by a beam segment (half-width + the original +12px pad). */
export function beamHits<E extends { alive: boolean; x: number; y: number }>(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  width: number,
  enemies: readonly E[],
): E[] {
  const out: E[] = [];
  for (const e of enemies) {
    if (!e.alive) continue;
    if (distToSeg(e.x, e.y, ax, ay, bx, by) < width + 12) out.push(e);
  }
  return out;
}

/** Foes inside a mortar splash (radius + grace). */
export function splashHits<E extends { alive: boolean; x: number; y: number }>(
  x: number,
  y: number,
  radius: number,
  enemies: readonly E[],
): E[] {
  const out: E[] = [];
  for (const e of enemies) {
    if (!e.alive) continue;
    if (dist(x, y, e.x, e.y) <= radius + COMBAT.splashGrace) out.push(e);
  }
  return out;
}

/** Ember Chains rune: nearest foes to the victim, up to maxN within radius
 * (the victim itself is always excluded — chains fire whether or not the
 * triggering hit killed). */
export function chainTargets<E extends { alive: boolean; x: number; y: number }>(
  victim: E,
  enemies: readonly E[],
  maxN: number,
  radius: number,
): E[] {
  const near = enemies
    .filter((e) => e.alive && e !== victim)
    .sort((a, b) => dist(a.x, a.y, victim.x, victim.y) - dist(b.x, b.y, victim.x, victim.y));
  const out: E[] = [];
  for (const e of near) {
    if (out.length >= maxN) break;
    if (dist(e.x, e.y, victim.x, victim.y) > radius) continue;
    out.push(e);
  }
  return out;
}

// ---- projectiles ----

export interface BoltCore<E> {
  x: number;
  y: number;
  target: E | null;
  dest: Pt;
  speed: number;
}

/** Home + advance one ember bolt. Returns true on arrival (caller applies
 * the hit if the target still lives). */
export function stepBoltCore<E extends { alive: boolean; x: number; y: number }>(b: BoltCore<E>, dtMs: number): boolean {
  if (b.target && b.target.alive) b.dest = { x: b.target.x, y: b.target.y };
  const dx = b.dest.x - b.x;
  const dy = b.dest.y - b.y;
  const d = Math.hypot(dx, dy);
  const step = (b.speed * dtMs) / 1000;
  if (d <= step + 10) return true; // arrive (hit radius: step + 10)
  b.x += (dx / d) * step;
  b.y += (dy / d) * step;
  return false;
}

/** Advance a kiln shell's flight time; returns progress 0..1 (1 = landed,
 * detonate at `to`). */
export function stepShellCore(s: { from: Pt; to: Pt; t: number }, dtMs: number, durMs: number): number {
  s.t += dtMs;
  return Math.min(1, s.t / durMs);
}
