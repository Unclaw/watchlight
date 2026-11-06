// Shared wave-flow core — Phaser-free. Spawn-queue expansion from authored
// wave groups, rune offering rules and instant rune side-effects, lantern
// leak damage: one copy for GameScene and the balance simulator.
import { ENEMIES, EnemyKind, LevelDef, RuneDef, RUNES, SpawnGroup } from '../config';
import { RuneId } from '../runes-ids';

export interface SpawnAt {
  kind: EnemyKind;
  /** ms after wave start. */
  at: number;
}

/** Expand wave groups into a time-sorted spawn queue. */
export function buildSpawnQueue(groups: readonly SpawnGroup[]): SpawnAt[] {
  const q: SpawnAt[] = [];
  for (const grp of groups) {
    for (let i = 0; i < grp.count; i++) q.push({ kind: grp.kind, at: (grp.delay + i * grp.gap) * 1000 });
  }
  return q.sort((a, b) => a.at - b.at);
}

/** Rune offering pool: tower-tagged runes only while that tower is
 * buildable this level; owned runes never re-offered (fortune is the
 * repeatable filler). Shuffling + slicing stays with the caller's rune
 * stream. */
export function runeOfferPool(level: LevelDef, owned: ReadonlySet<string>): RuneDef[] {
  return RUNES.filter(
    (r) => (!r.tower || level.towers.includes(r.tower)) && (!owned.has(r.id) || r.id === RuneId.fortune),
  );
}

/** Instant rune effects as deltas (the effect table is canonical — M2). */
export function runeInstants(id: string): { gold: number; maxHpPlus: number; healToFull: boolean } {
  const e = RUNES.find((r) => r.id === id)?.effect;
  if (e?.kind === 'instant' && e.apply === 'sturdy') return { gold: 0, maxHpPlus: 8, healToFull: true };
  if (e?.kind === 'instant' && e.apply === 'fortune') return { gold: 80, maxHpPlus: 0, healToFull: false };
  return { gold: 0, maxHpPlus: 0, healToFull: false };
}

/** Lantern damage when one creature leaks (floored at 0). */
export function leakDamage(hp: number, kind: EnemyKind): number {
  return Math.max(0, hp - ENEMIES[kind].leak);
}
