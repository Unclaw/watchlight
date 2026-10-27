// Rune effects — every gameplay modifier a rune applies, in one place.
// The content table (names/descriptions/pick pool) lives in config.ts RUNES;
// this module is the *behaviour* side, so balancing a rune means touching
// exactly one function here.
import { RuneId } from './runes-ids';

type Runes = ReadonlySet<string>;

/** Towers fire faster (Overcharge). */
export const rateMult = (r: Runes): number => (r.has(RuneId.overcharge) ? 1.15 : 1);
/** Tower range (Long Sight). */
export const rangeMult = (r: Runes): number => (r.has(RuneId.farsight) ? 1.12 : 1);
/** Prism damage (Focus Lens). */
export const prismDmgMult = (r: Runes): number => (r.has(RuneId.focusLens) ? 1.35 : 1);
/** Kiln splash radius (Volatile Kiln). */
export const splashMult = (r: Runes): number => (r.has(RuneId.volatile) ? 1.35 : 1);
/** Halo slow factor multiplier (Cold Heart) — lower = stronger slow. */
export const slowMult = (r: Runes): number => (r.has(RuneId.coldHeart) ? 0.8 : 1);
/** Kill bounties (Greed). */
export const bountyMult = (r: Runes): number => (r.has(RuneId.greed) ? 1.3 : 1);
/** Build & upgrade costs (Swift Hands). */
export const costMult = (r: Runes): number => (r.has(RuneId.swift) ? 0.88 : 1);

/** Ember bolts chain to nearby foes (Spark Chains). */
export const hasChains = (r: Runes): boolean => r.has(RuneId.emberChains);
/** Halo auras apply a burn (Slow Burn). */
export const hasSlowBurn = (r: Runes): boolean => r.has(RuneId.slowBurn);
