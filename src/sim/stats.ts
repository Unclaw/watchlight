// Shared tower-stat core — Phaser-free. Effective stats (runes + Wisp
// Grove buffs) live HERE, once, consumed by Tower's getters (game) and the
// balance simulator alike. Any stat change is automatically both-sided.
import { TOWERS, TowerKind } from '../config';
import {
  costMult, emberRateMult, groveGainMult, groveRangeMult, kilnDmgMult, prismDmgMult,
  rangeMult, rateMult, slowMult, splashMult,
} from '../runes';

/** Minimal tower shape the stat core needs — both the game's Tower and the
 * sim's towers satisfy it structurally. */
export interface TowerStatSource {
  kind: TowerKind;
  tier: number;
  x: number;
  y: number;
}

/** Product of every Wisp Grove's buff covering this tower (multiplicative
 * stacking; groves buffing groves is a no-op — they have no attack stats).
 * Old Growth scales the BONUS, not the multiplier (1.15 → 1.225 at T1). */
export function groveBuffFor(
  tower: TowerStatSource,
  towers: readonly TowerStatSource[],
  runes: ReadonlySet<string>,
): { dmg: number; rate: number } {
  let dmg = 1;
  let rate = 1;
  const gain = groveGainMult(runes);
  for (const t of towers) {
    if (t.kind !== 'grove') continue;
    const dx = t.x - tower.x;
    const dy = t.y - tower.y;
    if (dx * dx + dy * dy > towerRange(t, runes) ** 2) continue;
    const buff = TOWERS.grove.tiers[t.tier].buff ?? { dmg: 1, rate: 1 };
    dmg *= 1 + (buff.dmg - 1) * gain;
    rate *= 1 + (buff.rate - 1) * gain;
  }
  return { dmg, rate };
}

export function towerRange(t: TowerStatSource, runes: ReadonlySet<string>): number {
  const r = TOWERS[t.kind].tiers[t.tier].range * rangeMult(runes);
  return t.kind === 'grove' ? r * groveRangeMult(runes) : r;
}

export function towerRate(
  t: TowerStatSource,
  towers: readonly TowerStatSource[],
  runes: ReadonlySet<string>,
): number {
  let r = TOWERS[t.kind].tiers[t.tier].rate * rateMult(runes) * groveBuffFor(t, towers, runes).rate;
  if (t.kind === 'ember') r *= emberRateMult(runes);
  return r;
}

export function towerDmg(
  t: TowerStatSource,
  towers: readonly TowerStatSource[],
  runes: ReadonlySet<string>,
): number {
  const base = TOWERS[t.kind].tiers[t.tier].dmg;
  const grove = groveBuffFor(t, towers, runes).dmg;
  if (t.kind === 'prism') return base * prismDmgMult(runes) * grove;
  if (t.kind === 'kiln') return base * kilnDmgMult(runes) * grove;
  return base * grove;
}

export function towerSplash(t: TowerStatSource, runes: ReadonlySet<string>): number {
  return (TOWERS[t.kind].tiers[t.tier].splash ?? 0) * splashMult(runes);
}

/** Missing slow stat = identity (no slowing) — never fabricate a slow (L4). */
export function towerSlow(t: TowerStatSource, runes: ReadonlySet<string>): number {
  return (TOWERS[t.kind].tiers[t.tier].slow ?? 1) * slowMult(runes);
}

/** Cost of the next tier (null at max) — runes can discount it. */
export function towerNextCost(t: TowerStatSource, runes: ReadonlySet<string>): number | null {
  if (t.tier >= 2) return null;
  return Math.round(TOWERS[t.kind].tiers[t.tier + 1].cost * costMult(runes));
}

/** Cost of a fresh tier-1 build. */
export function towerBuildCost(kind: TowerKind, runes: ReadonlySet<string>): number {
  return Math.round(TOWERS[kind].tiers[0].cost * costMult(runes));
}
