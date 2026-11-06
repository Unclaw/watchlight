// Rune effects — every gameplay modifier a rune applies, in one place.
// The content table (names/descriptions/effects/pick pool) lives in
// config.ts RUNES; this module derives the queries from that table's
// `effect` entries (M2: stat slots / flags / instants — no per-rune
// hand-written modifiers to drift out of sync).
import { RUNES, RuneStat } from './config';
import { RuneId } from './runes-ids';

type Runes = ReadonlySet<string>;

// ---- stat slots: product of every owned rune's multiplier on the slot ----
const STAT_OWNERS = new Map<RuneStat, { id: string; mult: number }[]>();
for (const r of RUNES) {
  if (r.effect.kind !== 'stat') continue;
  const list = STAT_OWNERS.get(r.effect.stat) ?? [];
  list.push({ id: r.id, mult: r.effect.mult });
  STAT_OWNERS.set(r.effect.stat, list);
}

/** Product of all owned multipliers on one stat slot (default 1). */
export function statMult(r: Runes, stat: RuneStat): number {
  let m = 1;
  for (const o of STAT_OWNERS.get(stat) ?? []) if (r.has(o.id)) m *= o.mult;
  return m;
}

// ---- named queries (hot paths — kept as one-liners over the index) ----
/** Towers fire faster (Overcharge). */
export const rateMult = (r: Runes): number => statMult(r, 'rate');
/** Tower range (Long Sight). */
export const rangeMult = (r: Runes): number => statMult(r, 'range');
/** Prism damage (Focus Lens). */
export const prismDmgMult = (r: Runes): number => statMult(r, 'prismDmg');
/** Kiln splash radius (Volatile Kiln). */
export const splashMult = (r: Runes): number => statMult(r, 'splash');
/** Halo slow factor multiplier (Cold Heart) — lower = stronger slow. */
export const slowMult = (r: Runes): number => statMult(r, 'slow');
/** Kill bounties (Greed). */
export const bountyMult = (r: Runes): number => statMult(r, 'bounty');
/** Build & upgrade costs (Swift Hands). */
export const costMult = (r: Runes): number => statMult(r, 'cost');
/** Ember fire rate (Quickspark). */
export const emberRateMult = (r: Runes): number => statMult(r, 'emberRate');
/** Prism beam hit width (Wide Lens). */
export const beamWidthMult = (r: Runes): number => statMult(r, 'beamWidth');
/** Kiln damage (Powder Keg). */
export const kilnDmgMult = (r: Runes): number => statMult(r, 'kilnDmg');
/** Wisp Grove reach (Deep Roots). */
export const groveRangeMult = (r: Runes): number => statMult(r, 'groveRange');
/** Wisp Grove bonus gain (Old Growth) — scales (buff − 1). */
export const groveGainMult = (r: Runes): number => statMult(r, 'groveGain');

// ---- flags ----
/** Ember bolts chain to nearby foes (Spark Chains). */
export const hasChains = (r: Runes): boolean =>
  RUNES.some((def) => def.id === RuneId.emberChains && def.effect.kind === 'flag' && r.has(def.id));
/** Halo auras apply a burn (Slow Burn). */
export const hasSlowBurn = (r: Runes): boolean =>
  RUNES.some((def) => def.id === RuneId.slowBurn && def.effect.kind === 'flag' && r.has(def.id));
