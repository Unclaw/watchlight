// ============================================================
// Watchlight — game data: map, towers, enemies, runes, waves.
// Logical playfield is 720×1280 (portrait). Everything is data-
// driven so content milestones only touch this file.
// ============================================================
import Phaser from 'phaser';
import { Rng } from './rng';
import { RuneId } from './runes-ids';

// ---------- Maps & Levels ----------
export const GAME_W = 720;
export const GAME_H = 1280;

export interface Pt {
  x: number;
  y: number;
}

export const PATH_WIDTH = 56;

export interface MapData {
  waypoints: Pt[];
  tiles: Pt[];
  lantern: Pt;
  flyerSpawns: Pt[];
}

/** Precomputed cumulative-segment index for a waypoint polyline. */
export interface PathIndex {
  len: number;
  posAt(d: number): Pt;
}

export function makePath(wps: Pt[]): PathIndex {
  const segs: { ax: number; ay: number; bx: number; by: number; len: number; acc: number }[] = [];
  let acc = 0;
  for (let i = 0; i < wps.length - 1; i++) {
    const a = wps[i];
    const b = wps[i + 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    segs.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y, len, acc });
    acc += len;
  }
  const len = segs.length ? segs[segs.length - 1].acc + segs[segs.length - 1].len : 0;
  return {
    len,
    posAt(d: number): Pt {
      for (let i = 0; i < segs.length; i++) {
        const s = segs[i];
        const end = s.acc + s.len;
        if (d <= end || i === segs.length - 1) {
          const t = s.len === 0 ? 0 : Phaser.Math.Clamp((d - s.acc) / s.len, 0, 1);
          return { x: s.ax + (s.bx - s.ax) * t, y: s.ay + (s.by - s.ay) * t };
        }
      }
      return { ...wps[wps.length - 1] };
    },
  };
}

// ---------- Towers ----------
export type TowerKind = 'ember' | 'prism' | 'halo' | 'kiln';

export interface TowerTier {
  dmg: number;
  rate: number; // shots per second (halo: aura ticks)
  range: number;
  cost: number; // upgrade cost to reach this tier (tier1 = build cost)
  splash?: number;
  slow?: number; // speed multiplier applied by halo
}
export interface TowerDef {
  kind: TowerKind;
  name: string;
  blurb: string;
  tiers: [TowerTier, TowerTier, TowerTier];
}

export const TOWERS: Record<TowerKind, TowerDef> = {
  ember: {
    kind: 'ember',
    name: 'Ember Spire',
    blurb: 'Fast single-target sparks',
    tiers: [
      { dmg: 14, rate: 2.4, range: 150, cost: 60 },
      { dmg: 24, rate: 2.7, range: 158, cost: 48 },
      { dmg: 40, rate: 3.0, range: 168, cost: 78 },
    ],
  },
  prism: {
    kind: 'prism',
    name: 'Prism Beam',
    blurb: 'Piercing line of light',
    tiers: [
      { dmg: 30, rate: 0.55, range: 205, cost: 95 },
      { dmg: 52, rate: 0.58, range: 215, cost: 76 },
      { dmg: 85, rate: 0.62, range: 228, cost: 124 },
    ],
  },
  halo: {
    kind: 'halo',
    name: 'Halo Bloom',
    blurb: 'Slowing aura, steady burn',
    tiers: [
      { dmg: 5, rate: 2, range: 130, cost: 85, slow: 0.6 },
      { dmg: 8, rate: 2, range: 150, cost: 68, slow: 0.5 },
      { dmg: 12, rate: 2, range: 170, cost: 110, slow: 0.42 },
    ],
  },
  kiln: {
    kind: 'kiln',
    name: 'Kiln',
    blurb: 'Heavy splash mortar',
    tiers: [
      { dmg: 46, rate: 0.38, range: 190, cost: 135, splash: 78 },
      { dmg: 80, rate: 0.4, range: 200, cost: 108, splash: 90 },
      { dmg: 130, rate: 0.44, range: 210, cost: 176, splash: 104 },
    ],
  },
};


// ---------- Enemies ----------
export type EnemyKind = 'runner' | 'swarm' | 'shielded' | 'flyer' | 'healer' | 'boss';

export interface EnemyDef {
  kind: EnemyKind;
  hp: number;
  speed: number; // px/s
  bounty: number;
  leak: number; // lantern damage when it gets through
  armor: number; // flat reduction per hit
  radius: number;
}

export const ENEMIES: Record<EnemyKind, EnemyDef> = {
  runner: { kind: 'runner', hp: 34, speed: 75, bounty: 4, leak: 1, armor: 0, radius: 18 },
  swarm: { kind: 'swarm', hp: 14, speed: 95, bounty: 2, leak: 1, armor: 0, radius: 13 },
  shielded: { kind: 'shielded', hp: 70, speed: 55, bounty: 8, leak: 2, armor: 6, radius: 22 },
  flyer: { kind: 'flyer', hp: 46, speed: 72, bounty: 7, leak: 1, armor: 0, radius: 18 },
  healer: { kind: 'healer', hp: 90, speed: 50, bounty: 10, leak: 2, armor: 2, radius: 21 },
  boss: { kind: 'boss', hp: 1400, speed: 32, bounty: 120, leak: 5, armor: 8, radius: 40 },
};

/** HP / bounty scale by wave. */
export function waveScale(wave: number): number {
  const w = wave - 1;
  return 1 + 0.22 * w + 0.02 * w * w;
}

// ---------- Level theming ----------
// Per-level ambience within the flat-vector-glow language: the night
// deepens as the descent progresses. All decor is cheap (one batched
// Graphics for stars, ≤12 additive motes, glow-sprite vignette corners).
export interface LevelTheme {
  /** Camera background. */
  bg: number;
  /** Tint of the big radial lift behind the playfield. */
  fieldGlow: number;
  /** Path bands (outer / inner). */
  path: number;
  pathInner: number;
  /** Tiny star dots on the upper field (0 = void). */
  stars: number;
  /** A pale moon disc (drawn top-right, behind HUD). */
  moon?: { x: number; y: number; r: number; alpha: number };
  /** Drifting ambient motes (color, count) — murk ash / fireflies. */
  motes?: { color: number; count: number; rise: boolean };
  /** Vignette strength at the corners (0 = none). */
  vignette: number;
}

// “Deepening Night” — the sky darkens as the descent progresses:
// dusk indigo + fireflies → cold moonlit blue → the red-tinged void.
// (Alternative sets explored 2026-10-26 live in git history + theme-variants/.)
export const THEMES: Record<number, LevelTheme> = {
  1: {
    bg: 0x0d1330, fieldGlow: 0x1c2c5a, path: 0x101a3a, pathInner: 0x141f45,
    stars: 55, motes: { color: 0xffc24b, count: 6, rise: false }, vignette: 0.12,
  },
  2: {
    bg: 0x0b1026, fieldGlow: 0x182450, path: 0x0e1734, pathInner: 0x121c40,
    stars: 34, moon: { x: 122, y: 150, r: 26, alpha: 0.8 },
    motes: { color: 0x4fd8eb, count: 8, rise: false }, vignette: 0.2,
  },
  3: {
    bg: 0x120c1e, fieldGlow: 0x33122e, path: 0x170f2a, pathInner: 0x1c1232,
    stars: 8, motes: { color: 0xff5f7a, count: 12, rise: true }, vignette: 0.32,
  },
};

// ---------- Waves & Levels ----------
export interface SpawnGroup {
  kind: EnemyKind;
  count: number;
  gap: number; // seconds between spawns
  delay: number; // seconds before group starts
}

export interface LevelDef {
  id: number;
  name: string;
  map: MapData;
  /** Handcrafted wave table; length = the level's wave count. */
  waves: SpawnGroup[][];
  startGold: number;
  lanternHp: number;
  /** Towers buildable in this level (progressive unlock across levels). */
  towers: TowerKind[];
  /** Enemy families that may appear (wave tables must comply). */
  roster: EnemyKind[];
  /** Rune picks after every 5th cleared wave. */
  runes: boolean;
  /** Multiplier on the global HP curve (per-level difficulty knob). */
  hpMult: number;
}

// Level 1 — The Crossing: the original validated map, gentle 10-wave intro.
// Ember + Halo vs runners & swarm.
const L1_WAVES: SpawnGroup[][] = [
  [{ kind: 'runner', count: 5, gap: 1.4, delay: 0 }],
  [{ kind: 'runner', count: 8, gap: 1.1, delay: 0 }],
  [
    { kind: 'runner', count: 8, gap: 1.1, delay: 0 },
    { kind: 'swarm', count: 5, gap: 0.5, delay: 4 },
  ],
  [{ kind: 'swarm', count: 14, gap: 0.45, delay: 0 }],
  [
    { kind: 'runner', count: 10, gap: 0.9, delay: 0 },
    { kind: 'swarm', count: 6, gap: 0.4, delay: 3 },
  ],
  [
    { kind: 'swarm', count: 16, gap: 0.35, delay: 0 },
    { kind: 'runner', count: 6, gap: 1.2, delay: 4 },
  ],
  [{ kind: 'runner', count: 12, gap: 0.8, delay: 0 }],
  [{ kind: 'swarm', count: 20, gap: 0.35, delay: 0 }],
  [
    { kind: 'runner', count: 14, gap: 0.7, delay: 0 },
    { kind: 'swarm', count: 8, gap: 0.4, delay: 3 },
  ],
  [
    { kind: 'swarm', count: 18, gap: 0.35, delay: 0 },
    { kind: 'runner', count: 12, gap: 0.5, delay: 3 },
  ],
];

// Level 2 — The Long Watch: horizontal serpentine. Prism joins to answer
// the shielded; flyers cut across the loops. Balanced 2026-10-25 (sim:
// meta 100% @4 leaks, flyer-aware opening 0-leak 3-star, weak dies ~w13).
const L2_WAVES: SpawnGroup[][] = [
  [{ kind: 'runner', count: 6, gap: 1.2, delay: 0 }],
  [
    { kind: 'runner', count: 8, gap: 1, delay: 0 },
    { kind: 'swarm', count: 5, gap: 0.5, delay: 4 },
  ],
  [{ kind: 'shielded', count: 6, gap: 2.2, delay: 0 }],
  [{ kind: 'swarm', count: 14, gap: 0.4, delay: 0 }],
  [
    { kind: 'runner', count: 8, gap: 1, delay: 0 },
    { kind: 'shielded', count: 4, gap: 2.5, delay: 4 },
  ],
  [
    { kind: 'flyer', count: 6, gap: 1.4, delay: 0 },
    { kind: 'runner', count: 8, gap: 1, delay: 3 },
  ],
  [{ kind: 'shielded', count: 10, gap: 1.8, delay: 0 }],
  [
    { kind: 'flyer', count: 8, gap: 1.1, delay: 0 },
    { kind: 'swarm', count: 10, gap: 0.4, delay: 3 },
  ],
  [
    { kind: 'runner', count: 14, gap: 0.7, delay: 0 },
    { kind: 'shielded', count: 4, gap: 2.5, delay: 5 },
  ],
  [
    { kind: 'shielded', count: 12, gap: 1.5, delay: 0 },
    { kind: 'flyer', count: 8, gap: 1.3, delay: 4 },
  ],
  [
    { kind: 'swarm', count: 16, gap: 0.3, delay: 0 },
    { kind: 'flyer', count: 6, gap: 1.6, delay: 5 },
  ],
  [
    { kind: 'shielded', count: 10, gap: 1.6, delay: 0 },
    { kind: 'runner', count: 10, gap: 0.8, delay: 4 },
  ],
  [{ kind: 'flyer', count: 12, gap: 0.9, delay: 0 }],
  [
    { kind: 'swarm', count: 20, gap: 0.3, delay: 0 },
    { kind: 'shielded', count: 8, gap: 1.8, delay: 4 },
  ],
  [
    { kind: 'shielded', count: 14, gap: 1.4, delay: 0 },
    { kind: 'flyer', count: 10, gap: 1, delay: 4 },
    { kind: 'runner', count: 10, gap: 0.8, delay: 8 },
  ],
];

// Level 3 — The Descent: the full bestiary. The original 20-wave table
// (playtested on the 14-tile Crossing) re-tuned for this map: late waves
// trimmed ~25%, flyer spikes softened, lantern 23hp (a war of attrition),
// and a 12th build tile at the lane convergence (360,860) so a lane-aware
// opening can chase a 0-leak clear. Boss finale untouched. Balanced
// 2026-10-25 (sim: flyer-rush meta 100% & 14% perfect runs, novice 74%,
// partial builds die ~w12).
const L3_WAVES: SpawnGroup[][] = [
  [{ kind: 'runner', count: 6, gap: 1.4, delay: 0 }],
  [{ kind: 'runner', count: 10, gap: 1.1, delay: 0 }],
  [
    { kind: 'runner', count: 8, gap: 1.1, delay: 0 },
    { kind: 'swarm', count: 4, gap: 0.5, delay: 4 },
  ],
  [
    { kind: 'swarm', count: 14, gap: 0.45, delay: 0 },
    { kind: 'runner', count: 4, gap: 1.2, delay: 2 },
  ],
  [
    { kind: 'runner', count: 10, gap: 0.9, delay: 0 },
    { kind: 'swarm', count: 8, gap: 0.4, delay: 3 },
    { kind: 'shielded', count: 2, gap: 2.5, delay: 6 },
  ],
  [
    { kind: 'shielded', count: 6, gap: 2.2, delay: 0 },
    { kind: 'runner', count: 8, gap: 1, delay: 4 },
  ],
  [
    { kind: 'swarm', count: 18, gap: 0.35, delay: 0 },
    { kind: 'swarm', count: 12, gap: 0.3, delay: 5 },
  ],
  [
    { kind: 'flyer', count: 2, gap: 2, delay: 2 },
    { kind: 'runner', count: 8, gap: 1, delay: 3 },
  ],
  [
    { kind: 'shielded', count: 8, gap: 1.8, delay: 0 },
    { kind: 'swarm', count: 10, gap: 0.4, delay: 4 },
  ],
  [
    { kind: 'boss', count: 1, gap: 1, delay: 1 },
    { kind: 'runner', count: 10, gap: 1.4, delay: 4 },
  ],
  [
    { kind: 'flyer', count: 5, gap: 1.5, delay: 0 },
    { kind: 'swarm', count: 10, gap: 0.45, delay: 3 },
  ],
  [
    { kind: 'shielded', count: 10, gap: 1.6, delay: 0 },
    { kind: 'shielded', count: 8, gap: 1.2, delay: 6 },
  ],
  [
    { kind: 'runner', count: 12, gap: 0.8, delay: 0 },
    { kind: 'healer', count: 3, gap: 3, delay: 3 },
    { kind: 'swarm', count: 10, gap: 0.4, delay: 6 },
  ],
  [
    { kind: 'flyer', count: 6, gap: 1, delay: 0 },
    { kind: 'runner', count: 5, gap: 1.2, delay: 5 },
  ],
  [
    { kind: 'swarm', count: 18, gap: 0.3, delay: 0 },
    { kind: 'healer', count: 3, gap: 2.5, delay: 4 },
  ],
  [
    { kind: 'shielded', count: 9, gap: 1.4, delay: 0 },
    { kind: 'flyer', count: 6, gap: 1.3, delay: 4 },
  ],
  [
    { kind: 'runner', count: 10, gap: 0.7, delay: 0 },
    { kind: 'swarm', count: 10, gap: 0.35, delay: 4 },
    { kind: 'healer', count: 3, gap: 3, delay: 8 },
  ],
  [
    { kind: 'shielded', count: 9, gap: 1.2, delay: 0 },
    { kind: 'flyer', count: 5, gap: 1.1, delay: 5 },
  ],
  [
    { kind: 'swarm', count: 14, gap: 0.3, delay: 0 },
    { kind: 'shielded', count: 9, gap: 1.4, delay: 3 },
    { kind: 'healer', count: 2, gap: 3, delay: 7 },
  ],
  [
    { kind: 'boss', count: 2, gap: 9, delay: 1 },
    { kind: 'shielded', count: 8, gap: 1.6, delay: 5 },
    { kind: 'swarm', count: 12, gap: 0.4, delay: 8 },
  ],
];

export const LEVELS: LevelDef[] = [
  {
    id: 1,
    name: 'The Crossing',
    map: {
      waypoints: [
        { x: 360, y: -60 }, { x: 360, y: 120 }, { x: 120, y: 120 }, { x: 120, y: 360 },
        { x: 600, y: 360 }, { x: 600, y: 640 }, { x: 200, y: 640 }, { x: 200, y: 880 },
        { x: 520, y: 880 }, { x: 520, y: 1000 }, { x: 360, y: 1000 },
      ],
      tiles: [
        { x: 440, y: 200 }, { x: 200, y: 280 }, { x: 40, y: 440 }, { x: 280, y: 440 },
        { x: 440, y: 440 }, { x: 680, y: 440 }, { x: 40, y: 560 }, { x: 280, y: 560 },
        { x: 120, y: 760 }, { x: 360, y: 760 }, { x: 600, y: 760 }, { x: 40, y: 920 },
        { x: 120, y: 940 }, { x: 680, y: 940 },
      ],
      lantern: { x: 360, y: 1000 },
      flyerSpawns: [{ x: 780, y: 200 }, { x: -60, y: 330 }, { x: 780, y: 560 }],
    },
    waves: L1_WAVES,
    startGold: 150,
    lanternHp: 20,
    towers: ['ember', 'halo'],
    roster: ['runner', 'swarm'],
    runes: true,
    hpMult: 1,
  },
  {
    id: 2,
    name: 'The Long Watch',
    map: {
      waypoints: [
        { x: -60, y: 180 }, { x: 600, y: 180 }, { x: 600, y: 420 }, { x: 120, y: 420 },
        { x: 120, y: 660 }, { x: 600, y: 660 }, { x: 600, y: 900 }, { x: 360, y: 900 },
        { x: 360, y: 1000 },
      ],
      tiles: [
        { x: 240, y: 300 }, { x: 480, y: 300 }, { x: 60, y: 300 },
        { x: 240, y: 540 }, { x: 480, y: 540 }, { x: 680, y: 540 },
        { x: 240, y: 780 }, { x: 480, y: 780 }, { x: 680, y: 780 },
        { x: 440, y: 960 }, { x: 300, y: 960 },
      ],
      lantern: { x: 360, y: 1000 },
      flyerSpawns: [{ x: 760, y: 240 }, { x: 760, y: 700 }, { x: 360, y: -80 }],
    },
    waves: L2_WAVES,
    startGold: 170,
    lanternHp: 20,
    towers: ['ember', 'halo', 'prism'],
    roster: ['runner', 'swarm', 'shielded', 'flyer'],
    runes: true,
    hpMult: 1,
  },
  {
    id: 3,
    name: 'The Descent',
    map: {
      waypoints: [
        { x: -60, y: 120 }, { x: 480, y: 120 }, { x: 480, y: 360 }, { x: 160, y: 360 },
        { x: 160, y: 600 }, { x: 560, y: 600 }, { x: 560, y: 840 }, { x: 240, y: 840 },
        { x: 240, y: 1000 },
      ],
      tiles: [
        { x: 600, y: 240 }, { x: 300, y: 240 }, { x: 60, y: 240 },
        { x: 320, y: 480 }, { x: 60, y: 480 }, { x: 700, y: 480 },
        { x: 320, y: 720 }, { x: 60, y: 720 }, { x: 700, y: 720 },
        { x: 120, y: 940 }, { x: 480, y: 940 }, { x: 360, y: 860 },
      ],
      lantern: { x: 240, y: 1000 },
      flyerSpawns: [{ x: 760, y: 300 }, { x: 760, y: 800 }, { x: -60, y: 700 }],
    },
    waves: L3_WAVES,
    startGold: 150,
    lanternHp: 23,
    towers: ['ember', 'halo', 'prism', 'kiln'],
    roster: ['runner', 'swarm', 'shielded', 'flyer', 'healer', 'boss'],
    runes: true,
    hpMult: 1,
  },
];

/** Endless composition beyond a level's table — deterministic per seed,
 * filtered to the level's roster. */
function endlessGroups(level: LevelDef, wave: number, rng: Rng): SpawnGroup[] {
  const over = wave - level.waves.length;
  const groups: SpawnGroup[] = [];
  const pool = level.roster.filter((k) => k !== 'boss');
  const n = 2 + Math.min(3, Math.floor(over / 3));
  const picks = rng.shuffle([...pool]).slice(0, Math.min(n, pool.length));
  picks.forEach((kind, i) => {
    const base = kind === 'swarm' ? 14 : kind === 'shielded' ? 8 : kind === 'healer' ? 3 : 8;
    groups.push({
      kind,
      count: Math.round(base * (1 + 0.1 * over)),
      gap: kind === 'swarm' ? 0.3 : 1,
      delay: i * 3,
    });
  });
  if (over % 5 === 0 && level.roster.includes('boss')) {
    groups.push({ kind: 'boss', count: 1 + Math.floor(over / 10), gap: 6, delay: 2 });
  }
  return groups;
}

export function waveGroups(level: LevelDef, wave: number, rng: Rng): SpawnGroup[] {
  if (wave <= level.waves.length) return level.waves[wave - 1];
  return endlessGroups(level, wave, rng);
}

// ---------- Runes (roguelite picks after every 5th wave) ----------
export interface RuneDef {
  id: RuneId;
  name: string;
  desc: string;
  accent: number; // display colour
  glyph: 'ember' | 'prism' | 'halo' | 'kiln' | 'heart' | 'coinStack' | 'sparkle' | 'bolt' | 'hand' | 'eye' | 'snow';
  /** Set when the rune modifies ONE specific tower: only offered while that
 * tower is in the level's roster (no dead picks like Volatile Kiln on
 * levels without the Kiln). */
  tower?: TowerKind;
}

export const RUNES: RuneDef[] = [
  { id: 'emberChains', name: 'Spark Chains', desc: 'Ember hits leap to 2 nearby foes at 50% damage.', accent: 0xffc24b, glyph: 'ember', tower: 'ember' },
  { id: 'focusLens', name: 'Focus Lens', desc: 'Prism Beam damage +35%.', accent: 0x4fd8eb, glyph: 'prism', tower: 'prism' },
  { id: 'slowBurn', name: 'Slow Burn', desc: 'Halo auras ignite: +8 damage per second.', accent: 0x9b8cff, glyph: 'halo', tower: 'halo' },
  { id: 'volatile', name: 'Volatile Kiln', desc: 'Kiln splash radius +35%.', accent: 0xff8b4b, glyph: 'kiln', tower: 'kiln' },
  { id: 'overcharge', name: 'Overcharge', desc: 'All towers fire 15% faster.', accent: 0xffc24b, glyph: 'bolt' },
  { id: 'greed', name: 'Greed', desc: 'All bounties +30%.', accent: 0x47e0a0, glyph: 'coinStack' },
  { id: 'sturdy', name: 'Sturdy Heart', desc: 'Lantern +8 max HP and fully refilled.', accent: 0xff6b7a, glyph: 'heart' },
  { id: 'swift', name: 'Swift Hands', desc: 'Build & upgrade costs −12%.', accent: 0x4fd8eb, glyph: 'hand' },
  { id: 'farsight', name: 'Long Sight', desc: 'All tower range +12%.', accent: 0x9b8cff, glyph: 'eye' },
  { id: 'coldHeart', name: 'Cold Heart', desc: 'Halo slow deepens (foes crawl 20% slower).', accent: 0x4fd8eb, glyph: 'snow', tower: 'halo' },
  { id: 'fortune', name: 'Fortune', desc: 'Gain 80 gold immediately.', accent: 0x47e0a0, glyph: 'sparkle' },
];

// ---------- Combat tuning ----------
// Everything a designer balances that isn't per-tower/per-enemy data.
// Previously hardcoded in GameScene/Enemy/Tower — retuning config silently
// did nothing (the halo aura tick was the live example of that trap).
export const COMBAT = {
  boltSpeed: 560, // ember homing bolt, px/s
  shellLeadMs: 750, // kiln shell flight time (also the aim-lead window)
  shellArc: 110, // kiln shell visual arc height, px
  beamWidthBase: 15, beamWidthPerTier: 7, // prism capsule hit half-width
  beamHeightBase: 10, beamHeightPerTier: 4, // prism visual thickness
  chainTargets: 2, chainDamageMult: 0.5, chainRadius: 130, // Spark Chains rune
  healerTickMs: 500, healerHealPct: 0.025, healerRadius: 130,
  auraSlowMs: 900, // halo slow/burn duration
  slowBurnDps: 8, // Slow Burn rune
  splashGrace: 14, // extra hit radius beyond kiln splash
  bossHpRamp: 0.05, bossHpAnchorWave: 10, // boss hp = 1 + ramp * (wave - anchor)
  armorPerWaves: 12, // flat armor bonus = floor(wave / armorPerWaves)
  varianceMin: 0.94, varianceMax: 1.06, // per-enemy speed variance
} as const;

// ---------- Economy ----------
export const START_GOLD = 150; // level default (LevelDef.startGold overrides)
export const START_HP = 20; // level default (LevelDef.lanternHp overrides)

/** Sell refunds — TUNABLE. Prep sells are zero-sum (you get back exactly
 * what you paid); during a wave the penalty applies. Refunds are floored
 * from `invested` (actual gold spent), so sell+rebuild cycles can never
 * create money at any rate <= 1. */
export const ECONOMY = {
  sellRefundPrep: 1.0, // full refund until the wave is started
  sellRefundWave: 0.6, // penalty rate while a wave is running
} as const;
export function waveBonus(wave: number): number {
  return 12 + 4 * wave;
}
