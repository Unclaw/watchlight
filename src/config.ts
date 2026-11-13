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
export type TowerKind = 'ember' | 'prism' | 'halo' | 'kiln' | 'grove';

export interface TowerTier {
  dmg: number;
  rate: number; // shots per second (halo: aura ticks)
  range: number;
  cost: number; // upgrade cost to reach this tier (tier1 = build cost)
  splash?: number;
  slow?: number; // speed multiplier applied by halo
  buff?: { dmg: number; rate: number }; // grove: multipliers granted to towers in range
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
  grove: {
    // support amp: no attack of its own — nearby towers hit harder & faster
    kind: 'grove',
    name: 'Wisp Grove',
    blurb: 'Empowers nearby towers',
    tiers: [
      { dmg: 0, rate: 0, range: 150, cost: 70, buff: { dmg: 1.15, rate: 1.1 } },
      { dmg: 0, rate: 0, range: 162, cost: 56, buff: { dmg: 1.22, rate: 1.15 } },
      { dmg: 0, rate: 0, range: 174, cost: 92, buff: { dmg: 1.3, rate: 1.2 } },
    ],
  },
};


// ---------- Enemies ----------
export type EnemyKind =
  | 'runner'
  | 'swarm'
  | 'shielded'
  | 'flyer'
  | 'healer'
  | 'boss'
  | 'miniboss'
  | 'heartwood';

/** Boss-family kinds: HP scales by the anchored ramp (not the quadratic
 * wave curve), they show the boss bar/banner, and they never roll into
 * endless random composition. */
export const BOSS_LIKES: ReadonlySet<EnemyKind> = new Set(['boss', 'miniboss', 'heartwood']);

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
  miniboss: { kind: 'miniboss', hp: 520, speed: 36, bounty: 60, leak: 4, armor: 6, radius: 30 },
  heartwood: { kind: 'heartwood', hp: 3400, speed: 25, bounty: 250, leak: 10, armor: 10, radius: 52 },
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

/** Woods-overlay style: how far the forest wraps around the playfield.
 *  - 'frame'    — side columns + bottom strip, moderate and regular
 *  - 'encroach' — fewer, larger canopy fingers pinching in + sparse floor
 *  - 'surround' — continuous packed canopy wall on all edges (densest) */
export type WoodsStyle = 'frame' | 'encroach' | 'surround';

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
  /** Drifting ambient motes (color, count) — fireflies / spores / mist. */
  motes?: { color: number; count: number; rise: boolean };
  /** Conifer treeline silhouette across the top band — the woodlands mark.
   *  count ≈ density, band ≈ how far down the forest reaches (canopy feel).
   *  style wraps the forest around the frame. 2026-11-11: operator picked
   *  'frame' (variant A of 3 — regular side columns + bottom strip, most
   *  subtle; review shots in git history + archive). ?woods= overrides for
   *  debug. */
  trees?: { color: number; count: number; band: number; style?: WoodsStyle };
  /** Vignette strength at the corners (0 = none). */
  vignette: number;
}

// “Into the Woodlands” — one continuous woodlands-at-night arc across the
// ten levels: dusk grove → moonlit pines → bog thicket → fog hollow →
// bramble maze → wisp woods → old paths → silent grove → rootways →
// heartwood arena. (The previous “Deepening Night” set + explored
// alternates live in git history + theme-variants/.)
export const THEMES: Record<number, LevelTheme> = {
  1: {
    bg: 0x131a33, fieldGlow: 0x27335c, path: 0x17213d, pathInner: 0x1b2748,
    stars: 40, motes: { color: 0xffc24b, count: 6, rise: false },
    trees: { color: 0x0c1226, count: 26, band: 90, style: 'frame' }, vignette: 0.12,
  },
  2: {
    bg: 0x0c1428, fieldGlow: 0x1a2c52, path: 0x101c34, pathInner: 0x14213e,
    stars: 30, moon: { x: 122, y: 150, r: 26, alpha: 0.8 },
    motes: { color: 0x4fd8eb, count: 8, rise: false },
    trees: { color: 0x081020, count: 34, band: 110, style: 'frame' }, vignette: 0.2,
  },
  3: {
    bg: 0x0f1a17, fieldGlow: 0x1d3a2c, path: 0x13221d, pathInner: 0x182a22,
    stars: 6, motes: { color: 0x9fe6a0, count: 10, rise: true },
    trees: { color: 0x0a120f, count: 20, band: 70, style: 'frame' }, vignette: 0.3,
  },
  4: {
    bg: 0x11161d, fieldGlow: 0x232f3f, path: 0x151d26, pathInner: 0x1a2430,
    stars: 4, motes: { color: 0xb9c8d6, count: 8, rise: false },
    trees: { color: 0x0c1117, count: 24, band: 100, style: 'frame' }, vignette: 0.38,
  },
  5: {
    bg: 0x0e1416, fieldGlow: 0x21343a, path: 0x121d20, pathInner: 0x172428,
    stars: 8, motes: { color: 0x9b8cff, count: 6, rise: false },
    trees: { color: 0x091010, count: 40, band: 130, style: 'frame' }, vignette: 0.34,
  },
  6: {
    bg: 0x0b1614, fieldGlow: 0x1b3a30, path: 0x0f211c, pathInner: 0x132a23,
    stars: 12, motes: { color: 0x47e0a0, count: 12, rise: false },
    trees: { color: 0x081311, count: 36, band: 120, style: 'frame' }, vignette: 0.26,
  },
  7: {
    bg: 0x101722, fieldGlow: 0x243248, path: 0x141d2c, pathInner: 0x192333,
    stars: 20, moon: { x: 596, y: 120, r: 18, alpha: 0.6 },
    motes: { color: 0x93a1c4, count: 6, rise: false },
    trees: { color: 0x0a101a, count: 28, band: 95, style: 'frame' }, vignette: 0.28,
  },
  8: {
    bg: 0x0a0f14, fieldGlow: 0x18242f, path: 0x0e161e, pathInner: 0x121b25,
    stars: 2, motes: { color: 0x9b8cff, count: 8, rise: false },
    trees: { color: 0x060a0e, count: 44, band: 150, style: 'frame' }, vignette: 0.42,
  },
  9: {
    bg: 0x160f14, fieldGlow: 0x3a2430, path: 0x1c1218, pathInner: 0x22161e,
    stars: 0, motes: { color: 0xffc24b, count: 10, rise: true },
    trees: { color: 0x120a0e, count: 30, band: 90, style: 'frame' }, vignette: 0.36,
  },
  10: {
    bg: 0x1a0f0d, fieldGlow: 0x4a221a, path: 0x241412, pathInner: 0x2a1815,
    stars: 0, motes: { color: 0xff8b4b, count: 14, rise: true },
    trees: { color: 0x150b09, count: 30, band: 90, style: 'frame' }, vignette: 0.34,
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
  /** Biome this level belongs to (drives background music; default woodlands). */
  biome?: 'woodlands' | 'deepmarsh' | 'ashen';
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
  /** Marks the full-bestiary map used by daily & endless runs. */
  bestiary?: boolean;
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
// opening can chase a 0-leak clear. Miniboss at w10 (was: generic boss);
// the double-boss finale (w20) is untouched. Balanced 2026-10-25 (sim:
// flyer-rush meta 100% & 14% perfect runs, novice 74%, partial builds die ~w12).
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
    { kind: 'miniboss', count: 1, gap: 1, delay: 1 },
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

// Level 4 — The Fog Hollow: healer debut. Wide S-bends in the mist;
// healers teach target priority (kill the glow first).
const L4_WAVES: SpawnGroup[][] = [
  [{ kind: 'runner', count: 6, gap: 1.3, delay: 0 }],
  [{ kind: 'runner', count: 9, gap: 1.1, delay: 0 }],
  [
    { kind: 'swarm', count: 12, gap: 0.45, delay: 0 },
    { kind: 'runner', count: 4, gap: 1.2, delay: 3 },
  ],
  [{ kind: 'shielded', count: 5, gap: 2.2, delay: 0 }],
  [
    { kind: 'runner', count: 10, gap: 0.9, delay: 0 },
    { kind: 'healer', count: 1, gap: 3, delay: 4 },
  ],
  [{ kind: 'flyer', count: 5, gap: 1.4, delay: 0 }],
  [
    { kind: 'shielded', count: 8, gap: 1.8, delay: 0 },
    { kind: 'swarm', count: 6, gap: 0.4, delay: 4 },
  ],
  [
    { kind: 'healer', count: 2, gap: 4, delay: 0 },
    { kind: 'runner', count: 12, gap: 0.8, delay: 2 },
  ],
  [
    { kind: 'swarm', count: 16, gap: 0.35, delay: 0 },
    { kind: 'flyer', count: 3, gap: 1.6, delay: 5 },
  ],
  [
    { kind: 'shielded', count: 10, gap: 1.6, delay: 0 },
    { kind: 'healer', count: 1, gap: 3.5, delay: 5 },
  ],
  [{ kind: 'flyer', count: 6, gap: 1.2, delay: 0 }],
  [
    { kind: 'runner', count: 8, gap: 0.7, delay: 0 },
    { kind: 'swarm', count: 6, gap: 0.4, delay: 4 },
  ],
  [
    { kind: 'shielded', count: 5, gap: 1.5, delay: 0 },
    { kind: 'healer', count: 2, gap: 3, delay: 4 },
    { kind: 'flyer', count: 3, gap: 1.5, delay: 8 },
  ],
  [
    { kind: 'swarm', count: 12, gap: 0.3, delay: 0 },
    { kind: 'healer', count: 1, gap: 3.5, delay: 5 },
  ],
  [
    { kind: 'flyer', count: 4, gap: 1.1, delay: 0 },
    { kind: 'runner', count: 5, gap: 1, delay: 4 },
  ],
  [
    { kind: 'shielded', count: 6, gap: 1.4, delay: 0 },
    { kind: 'healer', count: 2, gap: 3, delay: 6 },
  ],
  [
    { kind: 'runner', count: 11, gap: 0.6, delay: 0 },
    { kind: 'swarm', count: 8, gap: 0.35, delay: 5 },
    { kind: 'flyer', count: 5, gap: 1.4, delay: 9 },
  ],
  [
    { kind: 'shielded', count: 7, gap: 1.5, delay: 0 },
    { kind: 'flyer', count: 5, gap: 1.2, delay: 4 },
    { kind: 'healer', count: 2, gap: 3, delay: 7 },
  ],
];

// Level 5 — The Bramble Maze: tight zigzags, the swarm-flood level. Bursts
// come faster than the bends can drain them — splash and auras pay rent.
const L5_WAVES: SpawnGroup[][] = [
  [{ kind: 'runner', count: 6, gap: 1.3, delay: 0 }],
  [
    { kind: 'swarm', count: 14, gap: 0.4, delay: 0 },
    { kind: 'runner', count: 5, gap: 1.1, delay: 4 },
  ],
  [{ kind: 'swarm', count: 18, gap: 0.35, delay: 0 }],
  [
    { kind: 'runner', count: 10, gap: 0.9, delay: 0 },
    { kind: 'swarm', count: 8, gap: 0.35, delay: 3 },
  ],
  [
    { kind: 'shielded', count: 6, gap: 2, delay: 0 },
    { kind: 'swarm', count: 12, gap: 0.35, delay: 4 },
  ],
  [
    { kind: 'swarm', count: 16, gap: 0.3, delay: 0 },
    { kind: 'swarm', count: 10, gap: 0.28, delay: 6 },
  ],
  [
    { kind: 'flyer', count: 6, gap: 1.3, delay: 0 },
    { kind: 'runner', count: 8, gap: 1, delay: 3 },
  ],
  [
    { kind: 'shielded', count: 8, gap: 1.8, delay: 0 },
    { kind: 'swarm', count: 14, gap: 0.32, delay: 4 },
  ],
  [
    { kind: 'swarm', count: 16, gap: 0.28, delay: 0 },
    { kind: 'healer', count: 2, gap: 3.5, delay: 6 },
  ],
  [
    { kind: 'runner', count: 14, gap: 0.7, delay: 0 },
    { kind: 'swarm', count: 12, gap: 0.3, delay: 4 },
  ],
  [
    { kind: 'flyer', count: 6, gap: 1.2, delay: 0 },
    { kind: 'swarm', count: 12, gap: 0.3, delay: 4 },
  ],
  [
    { kind: 'shielded', count: 10, gap: 1.6, delay: 0 },
    { kind: 'healer', count: 2, gap: 3, delay: 5 },
  ],
  [
    { kind: 'swarm', count: 18, gap: 0.26, delay: 0 },
    { kind: 'swarm', count: 12, gap: 0.24, delay: 6 },
  ],
  [
    { kind: 'shielded', count: 8, gap: 1.6, delay: 0 },
    { kind: 'flyer', count: 6, gap: 1.4, delay: 4 },
  ],
  [
    { kind: 'runner', count: 13, gap: 0.6, delay: 0 },
    { kind: 'healer', count: 2, gap: 3, delay: 4 },
    { kind: 'swarm', count: 10, gap: 0.3, delay: 7 },
  ],
  [
    { kind: 'swarm', count: 18, gap: 0.24, delay: 0 },
    { kind: 'flyer', count: 6, gap: 1.2, delay: 5 },
  ],
  [
    { kind: 'shielded', count: 8, gap: 1.5, delay: 0 },
    { kind: 'swarm', count: 10, gap: 0.28, delay: 5 },
    { kind: 'healer', count: 2, gap: 3, delay: 8 },
  ],
  [
    { kind: 'runner', count: 12, gap: 0.55, delay: 0 },
    { kind: 'swarm', count: 14, gap: 0.26, delay: 4 },
  ],
  [
    { kind: 'swarm', count: 20, gap: 0.22, delay: 0 },
    { kind: 'shielded', count: 6, gap: 1.8, delay: 5 },
    { kind: 'healer', count: 2, gap: 3, delay: 8 },
  ],
  [
    { kind: 'flyer', count: 8, gap: 1, delay: 0 },
    { kind: 'swarm', count: 14, gap: 0.24, delay: 4 },
    { kind: 'shielded', count: 7, gap: 1.5, delay: 8 },
  ],
];

// Level 6 — The Wisp Woods: the grove debut. Tile clusters reward planting
// Wisps among your best; the first miniboss tests the mid-game wall.
const L6_WAVES: SpawnGroup[][] = [
  [{ kind: 'runner', count: 6, gap: 1.3, delay: 0 }],
  [
    { kind: 'runner', count: 9, gap: 1, delay: 0 },
    { kind: 'swarm', count: 6, gap: 0.4, delay: 4 },
  ],
  [
    { kind: 'shielded', count: 6, gap: 2, delay: 0 },
    { kind: 'swarm', count: 10, gap: 0.4, delay: 4 },
  ],
  [
    { kind: 'runner', count: 12, gap: 0.8, delay: 0 },
    { kind: 'flyer', count: 4, gap: 1.6, delay: 4 },
  ],
  [
    { kind: 'swarm', count: 18, gap: 0.32, delay: 0 },
    { kind: 'healer', count: 2, gap: 3, delay: 5 },
  ],
  [
    { kind: 'shielded', count: 8, gap: 1.7, delay: 0 },
    { kind: 'runner', count: 8, gap: 1, delay: 4 },
  ],
  [
    { kind: 'flyer', count: 8, gap: 1.2, delay: 0 },
    { kind: 'swarm', count: 12, gap: 0.35, delay: 4 },
  ],
  [
    { kind: 'runner', count: 14, gap: 0.7, delay: 0 },
    { kind: 'healer', count: 2, gap: 3.5, delay: 4 },
  ],
  [
    { kind: 'shielded', count: 10, gap: 1.6, delay: 0 },
    { kind: 'swarm', count: 12, gap: 0.32, delay: 4 },
    { kind: 'flyer', count: 4, gap: 1.5, delay: 8 },
  ],
  [
    { kind: 'miniboss', count: 1, gap: 1, delay: 1 },
    { kind: 'runner', count: 10, gap: 1.2, delay: 4 },
  ],
  [
    { kind: 'flyer', count: 8, gap: 1.1, delay: 0 },
    { kind: 'healer', count: 2, gap: 3, delay: 4 },
  ],
  [
    { kind: 'swarm', count: 18, gap: 0.28, delay: 0 },
    { kind: 'shielded', count: 5, gap: 2, delay: 5 },
  ],
  [
    { kind: 'runner', count: 16, gap: 0.6, delay: 0 },
    { kind: 'flyer', count: 6, gap: 1.3, delay: 5 },
  ],
  [
    { kind: 'shielded', count: 12, gap: 1.5, delay: 0 },
    { kind: 'healer', count: 3, gap: 3, delay: 5 },
  ],
  [
    { kind: 'swarm', count: 18, gap: 0.26, delay: 0 },
    { kind: 'flyer', count: 6, gap: 1.2, delay: 6 },
  ],
  [
    { kind: 'runner', count: 18, gap: 0.55, delay: 0 },
    { kind: 'shielded', count: 8, gap: 1.6, delay: 4 },
    { kind: 'healer', count: 2, gap: 3, delay: 8 },
  ],
  [
    { kind: 'shielded', count: 9, gap: 1.4, delay: 0 },
    { kind: 'swarm', count: 12, gap: 0.28, delay: 5 },
  ],
  [
    { kind: 'flyer', count: 8, gap: 1, delay: 0 },
    { kind: 'runner', count: 9, gap: 0.8, delay: 5 },
    { kind: 'healer', count: 2, gap: 3, delay: 8 },
  ],
  [
    { kind: 'swarm', count: 18, gap: 0.24, delay: 0 },
    { kind: 'shielded', count: 7, gap: 1.5, delay: 5 },
  ],
  [
    { kind: 'miniboss', count: 2, gap: 8, delay: 1 },
    { kind: 'shielded', count: 6, gap: 1.6, delay: 5 },
    { kind: 'flyer', count: 6, gap: 1.2, delay: 9 },
  ],
];

// Level 7 — The Old Paths: the long spiral. Walkers take the scenic route;
// healers arrive in delegation — target discipline or grind forever.
// 2026-11-11: 0-leak-ceiling pass (was min-leak 1 across 30 seeds — flag
// from the remake session): w16 flyer 12→8 + healer 3→2 (two trims).
const L7_WAVES: SpawnGroup[][] = [
  [{ kind: 'runner', count: 6, gap: 1.3, delay: 0 }],
  [
    { kind: 'runner', count: 10, gap: 1, delay: 0 },
    { kind: 'swarm', count: 6, gap: 0.4, delay: 4 },
  ],
  [
    { kind: 'shielded', count: 6, gap: 2.2, delay: 0 },
    { kind: 'healer', count: 1, gap: 3, delay: 5 },
  ],
  [
    { kind: 'swarm', count: 16, gap: 0.35, delay: 0 },
    { kind: 'runner', count: 6, gap: 1.1, delay: 4 },
  ],
  [
    { kind: 'flyer', count: 6, gap: 1.4, delay: 0 },
    { kind: 'shielded', count: 5, gap: 2.2, delay: 4 },
  ],
  [
    { kind: 'healer', count: 2, gap: 3.5, delay: 0 },
    { kind: 'runner', count: 12, gap: 0.8, delay: 2 },
  ],
  [
    { kind: 'shielded', count: 10, gap: 1.7, delay: 0 },
    { kind: 'swarm', count: 12, gap: 0.35, delay: 5 },
  ],
  [
    { kind: 'flyer', count: 8, gap: 1.2, delay: 0 },
    { kind: 'healer', count: 2, gap: 3, delay: 4 },
  ],
  [
    { kind: 'runner', count: 16, gap: 0.65, delay: 0 },
    { kind: 'shielded', count: 6, gap: 2, delay: 5 },
  ],
  [
    { kind: 'swarm', count: 22, gap: 0.3, delay: 0 },
    { kind: 'healer', count: 3, gap: 3, delay: 5 },
  ],
  [
    { kind: 'shielded', count: 12, gap: 1.5, delay: 0 },
    { kind: 'flyer', count: 6, gap: 1.4, delay: 5 },
  ],
  [
    { kind: 'healer', count: 3, gap: 3, delay: 0 },
    { kind: 'runner', count: 14, gap: 0.7, delay: 2 },
    { kind: 'swarm', count: 12, gap: 0.3, delay: 6 },
  ],
  [
    { kind: 'flyer', count: 9, gap: 1.1, delay: 0 },
    { kind: 'shielded', count: 8, gap: 1.7, delay: 5 },
  ],
  [
    { kind: 'swarm', count: 18, gap: 0.26, delay: 0 },
    { kind: 'healer', count: 2, gap: 3, delay: 6 },
  ],
  [
    { kind: 'runner', count: 13, gap: 0.6, delay: 0 },
    { kind: 'shielded', count: 6, gap: 1.6, delay: 5 },
    { kind: 'healer', count: 2, gap: 3, delay: 8 },
  ],
  [
    { kind: 'flyer', count: 8, gap: 1, delay: 0 },
    { kind: 'healer', count: 2, gap: 3, delay: 4 },
  ],
  [
    { kind: 'shielded', count: 10, gap: 1.4, delay: 0 },
    { kind: 'swarm', count: 12, gap: 0.28, delay: 5 },
  ],
  [
    { kind: 'runner', count: 14, gap: 0.55, delay: 0 },
    { kind: 'flyer', count: 6, gap: 1.2, delay: 6 },
    { kind: 'healer', count: 3, gap: 2.8, delay: 9 },
  ],
  [
    { kind: 'swarm', count: 18, gap: 0.24, delay: 0 },
    { kind: 'shielded', count: 7, gap: 1.5, delay: 5 },
    { kind: 'healer', count: 3, gap: 2.8, delay: 8 },
  ],
  [
    { kind: 'shielded', count: 10, gap: 1.4, delay: 0 },
    { kind: 'flyer', count: 7, gap: 1.1, delay: 5 },
    { kind: 'healer', count: 3, gap: 2.8, delay: 8 },
    { kind: 'runner', count: 10, gap: 0.7, delay: 12 },
  ],
];

// Level 8 — The Silent Grove: shielded trains under flyers. Prism walls
// answer armor; kilns answer the clumps the staggered switchbacks make.
// 2026-11-11: flyer waves trimmed one notch for the west-hollow rework
// (lanes are longer diagonals; w12 10→9, w17 5→4, w22 6→5) — the flyer
// lane exposure is the difficulty dial (DEV_NOTES §8).
const L8_WAVES: SpawnGroup[][] = [
  [{ kind: 'runner', count: 7, gap: 1.2, delay: 0 }],
  [
    { kind: 'swarm', count: 14, gap: 0.4, delay: 0 },
    { kind: 'runner', count: 5, gap: 1.1, delay: 4 },
  ],
  [{ kind: 'shielded', count: 6, gap: 2.1, delay: 0 }],
  [
    { kind: 'flyer', count: 5, gap: 1.5, delay: 0 },
    { kind: 'runner', count: 8, gap: 1, delay: 3 },
  ],
  [
    { kind: 'shielded', count: 8, gap: 1.8, delay: 0 },
    { kind: 'swarm', count: 10, gap: 0.38, delay: 4 },
  ],
  [
    { kind: 'runner', count: 14, gap: 0.7, delay: 0 },
    { kind: 'healer', count: 2, gap: 3.5, delay: 4 },
  ],
  [
    { kind: 'flyer', count: 8, gap: 1.2, delay: 0 },
    { kind: 'shielded', count: 6, gap: 2, delay: 4 },
  ],
  [
    { kind: 'swarm', count: 12, gap: 0.32, delay: 0 },
    { kind: 'swarm', count: 6, gap: 0.28, delay: 5 },
  ],
  [
    { kind: 'shielded', count: 10, gap: 1.6, delay: 0 },
    { kind: 'healer', count: 2, gap: 3, delay: 5 },
  ],
  [
    { kind: 'runner', count: 12, gap: 0.65, delay: 0 },
    { kind: 'flyer', count: 5, gap: 1.3, delay: 5 },
  ],
  [
    { kind: 'shielded', count: 8, gap: 1.5, delay: 0 },
    { kind: 'shielded', count: 6, gap: 1.3, delay: 6 },
  ],
  [
    { kind: 'flyer', count: 9, gap: 1.1, delay: 0 },
    { kind: 'healer', count: 2, gap: 3, delay: 4 },
  ],
  [
    { kind: 'swarm', count: 12, gap: 0.28, delay: 0 },
    { kind: 'shielded', count: 5, gap: 1.6, delay: 5 },
  ],
  [
    { kind: 'runner', count: 13, gap: 0.6, delay: 0 },
    { kind: 'shielded', count: 5, gap: 1.6, delay: 5 },
  ],
  [
    { kind: 'flyer', count: 7, gap: 1, delay: 0 },
    { kind: 'healer', count: 2, gap: 3, delay: 4 },
    { kind: 'swarm', count: 11, gap: 0.3, delay: 8 },
  ],
  [
    { kind: 'shielded', count: 10, gap: 1.4, delay: 0 },
    { kind: 'healer', count: 2, gap: 3, delay: 6 },
  ],
  [
    { kind: 'swarm', count: 14, gap: 0.24, delay: 0 },
    { kind: 'flyer', count: 4, gap: 1.2, delay: 6 },
  ],
  [
    { kind: 'runner', count: 11, gap: 0.55, delay: 0 },
    { kind: 'shielded', count: 6, gap: 1.5, delay: 5 },
    { kind: 'healer', count: 3, gap: 2.8, delay: 8 },
  ],
  [
    { kind: 'shielded', count: 8, gap: 1.3, delay: 0 },
    { kind: 'swarm', count: 10, gap: 0.26, delay: 6 },
  ],
  [
    { kind: 'flyer', count: 6, gap: 0.9, delay: 0 },
    { kind: 'healer', count: 3, gap: 2.8, delay: 5 },
  ],
  [
    { kind: 'swarm', count: 16, gap: 0.22, delay: 0 },
    { kind: 'shielded', count: 7, gap: 1.4, delay: 5 },
    { kind: 'runner', count: 8, gap: 0.7, delay: 9 },
  ],
  [
    { kind: 'shielded', count: 9, gap: 1.2, delay: 0 },
    { kind: 'flyer', count: 5, gap: 1, delay: 6 },
    { kind: 'healer', count: 3, gap: 2.8, delay: 9 },
  ],
];

// Level 9 — The Rootways: the attrition grinder before the Heartwood.
// Six lanes, every family, no mercy gaps — the economy is the real boss.
const L9_WAVES: SpawnGroup[][] = [
  [{ kind: 'runner', count: 7, gap: 1.2, delay: 0 }],
  [
    { kind: 'runner', count: 10, gap: 0.9, delay: 0 },
    { kind: 'swarm', count: 8, gap: 0.38, delay: 4 },
  ],
  [
    { kind: 'shielded', count: 7, gap: 2, delay: 0 },
    { kind: 'swarm', count: 10, gap: 0.36, delay: 4 },
  ],
  [
    { kind: 'flyer', count: 6, gap: 1.4, delay: 0 },
    { kind: 'runner', count: 8, gap: 1, delay: 3 },
  ],
  [
    { kind: 'swarm', count: 14, gap: 0.32, delay: 0 },
    { kind: 'healer', count: 2, gap: 3.5, delay: 5 },
  ],
  [
    { kind: 'shielded', count: 9, gap: 1.7, delay: 0 },
    { kind: 'runner', count: 10, gap: 0.9, delay: 4 },
  ],
  [
    { kind: 'flyer', count: 9, gap: 1.1, delay: 0 },
    { kind: 'swarm', count: 12, gap: 0.32, delay: 4 },
  ],
  [
    { kind: 'runner', count: 16, gap: 0.65, delay: 0 },
    { kind: 'healer', count: 2, gap: 3.5, delay: 4 },
  ],
  [
    { kind: 'shielded', count: 12, gap: 1.5, delay: 0 },
    { kind: 'swarm', count: 14, gap: 0.3, delay: 4 },
  ],
  [
    { kind: 'flyer', count: 10, gap: 1.1, delay: 0 },
    { kind: 'shielded', count: 6, gap: 1.9, delay: 5 },
    { kind: 'healer', count: 2, gap: 3.5, delay: 8 },
  ],
  [
    { kind: 'swarm', count: 18, gap: 0.26, delay: 0 },
    { kind: 'shielded', count: 6, gap: 1.6, delay: 5 },
  ],
  [
    { kind: 'runner', count: 18, gap: 0.6, delay: 0 },
    { kind: 'flyer', count: 6, gap: 1.3, delay: 5 },
    { kind: 'healer', count: 2, gap: 3, delay: 8 },
  ],
  [
    { kind: 'shielded', count: 10, gap: 1.4, delay: 0 },
    { kind: 'swarm', count: 11, gap: 0.28, delay: 5 },
  ],
  [
    { kind: 'flyer', count: 12, gap: 1, delay: 0 },
    { kind: 'runner', count: 12, gap: 0.8, delay: 5 },
  ],
  [
    { kind: 'swarm', count: 20, gap: 0.24, delay: 0 },
    { kind: 'healer', count: 2, gap: 3, delay: 6 },
  ],
  [
    { kind: 'shielded', count: 9, gap: 1.3, delay: 0 },
    { kind: 'flyer', count: 6, gap: 1.2, delay: 5 },
  ],
  [
    { kind: 'runner', count: 14, gap: 0.55, delay: 0 },
    { kind: 'shielded', count: 7, gap: 1.5, delay: 5 },
    { kind: 'healer', count: 2, gap: 3, delay: 8 },
  ],
  [
    { kind: 'swarm', count: 20, gap: 0.22, delay: 0 },
    { kind: 'shielded', count: 7, gap: 1.5, delay: 5 },
    { kind: 'flyer', count: 6, gap: 1.2, delay: 9 },
  ],
  [
    { kind: 'flyer', count: 9, gap: 0.9, delay: 0 },
    { kind: 'healer', count: 3, gap: 2.8, delay: 5 },
  ],
  [
    { kind: 'shielded', count: 11, gap: 1.2, delay: 0 },
    { kind: 'runner', count: 10, gap: 0.7, delay: 6 },
  ],
  [
    { kind: 'swarm', count: 20, gap: 0.2, delay: 0 },
    { kind: 'healer', count: 3, gap: 2.8, delay: 6 },
  ],
  [
    { kind: 'shielded', count: 9, gap: 1.3, delay: 0 },
    { kind: 'flyer', count: 8, gap: 1, delay: 5 },
    { kind: 'healer', count: 3, gap: 2.8, delay: 9 },
  ],
  [
    { kind: 'runner', count: 14, gap: 0.5, delay: 0 },
    { kind: 'swarm', count: 11, gap: 0.24, delay: 6 },
    { kind: 'shielded', count: 8, gap: 1.4, delay: 12 },
  ],
];

// Level 10 — The Heartwood: the finale. A ring around the arena, a spire
// run to the Lantern, minibosses at w12, a boss herald at w18 — and at w25
// the Heartwood Murk itself walks, calling runner packs as it comes.
const L10_WAVES: SpawnGroup[][] = [
  [{ kind: 'runner', count: 6, gap: 1.2, delay: 0 }],
  [
    { kind: 'runner', count: 8, gap: 1, delay: 0 },
    { kind: 'swarm', count: 6, gap: 0.4, delay: 4 },
  ],
  [
    { kind: 'swarm', count: 10, gap: 0.35, delay: 0 },
    { kind: 'runner', count: 6, gap: 1, delay: 4 },
  ],
  [{ kind: 'shielded', count: 5, gap: 2.2, delay: 0 }],
  [{ kind: 'flyer', count: 5, gap: 1.5, delay: 0 }],
  [
    { kind: 'runner', count: 10, gap: 0.8, delay: 0 },
    { kind: 'healer', count: 1, gap: 3, delay: 5 },
  ],
  [
    { kind: 'shielded', count: 7, gap: 1.9, delay: 0 },
    { kind: 'swarm', count: 10, gap: 0.3, delay: 4 },
  ],
  [
    { kind: 'flyer', count: 7, gap: 1.2, delay: 0 },
    { kind: 'shielded', count: 5, gap: 2, delay: 5 },
  ],
  [
    { kind: 'swarm', count: 16, gap: 0.28, delay: 0 },
    { kind: 'shielded', count: 6, gap: 1.6, delay: 5 },
  ],
  [
    { kind: 'runner', count: 18, gap: 0.6, delay: 0 },
    { kind: 'flyer', count: 6, gap: 1.3, delay: 5 },
    { kind: 'healer', count: 2, gap: 3, delay: 8 },
  ],
  [
    { kind: 'shielded', count: 8, gap: 1.5, delay: 0 },
    { kind: 'swarm', count: 11, gap: 0.28, delay: 5 },
  ],
  [
    { kind: 'miniboss', count: 2, gap: 7, delay: 1 },
    { kind: 'runner', count: 10, gap: 1.1, delay: 5 },
  ],
  [
    { kind: 'flyer', count: 8, gap: 1, delay: 0 },
    { kind: 'healer', count: 2, gap: 3, delay: 5 },
  ],
  [
    { kind: 'swarm', count: 18, gap: 0.24, delay: 0 },
    { kind: 'shielded', count: 7, gap: 1.5, delay: 5 },
  ],
  [
    { kind: 'runner', count: 14, gap: 0.55, delay: 0 },
    { kind: 'shielded', count: 7, gap: 1.5, delay: 5 },
    { kind: 'healer', count: 2, gap: 3, delay: 8 },
  ],
  [
    { kind: 'flyer', count: 9, gap: 0.9, delay: 0 },
    { kind: 'swarm', count: 12, gap: 0.26, delay: 5 },
  ],
  [
    { kind: 'shielded', count: 10, gap: 1.3, delay: 0 },
    { kind: 'healer', count: 3, gap: 2.8, delay: 6 },
  ],
  [
    { kind: 'boss', count: 1, gap: 1, delay: 1 },
    { kind: 'shielded', count: 7, gap: 1.5, delay: 5 },
    { kind: 'flyer', count: 6, gap: 1.2, delay: 9 },
  ],
  [
    { kind: 'swarm', count: 20, gap: 0.22, delay: 0 },
    { kind: 'healer', count: 3, gap: 2.8, delay: 6 },
  ],
  [
    { kind: 'runner', count: 14, gap: 0.5, delay: 0 },
    { kind: 'shielded', count: 8, gap: 1.4, delay: 6 },
  ],
  [
    { kind: 'flyer', count: 9, gap: 0.85, delay: 0 },
    { kind: 'miniboss', count: 1, gap: 1, delay: 6 },
  ],
  [
    { kind: 'shielded', count: 11, gap: 1.2, delay: 0 },
    { kind: 'swarm', count: 15, gap: 0.24, delay: 5 },
    { kind: 'healer', count: 3, gap: 2.8, delay: 9 },
  ],
  [
    { kind: 'runner', count: 16, gap: 0.5, delay: 0 },
    { kind: 'flyer', count: 8, gap: 1, delay: 6 },
  ],
  [
    { kind: 'heartwood', count: 1, gap: 1, delay: 1 },
    { kind: 'shielded', count: 8, gap: 1.5, delay: 6 },
    { kind: 'swarm', count: 13, gap: 0.26, delay: 10 },
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
    roster: ['runner', 'swarm', 'shielded', 'flyer', 'healer', 'boss', 'miniboss'],
    runes: true,
    hpMult: 1,
    bestiary: true,
  },
  {
    id: 4,
    name: 'The Fog Hollow',
    map: {
      waypoints: [
        { x: -60, y: 140 }, { x: 560, y: 140 }, { x: 560, y: 400 }, { x: 160, y: 400 },
        { x: 160, y: 660 }, { x: 600, y: 660 }, { x: 600, y: 920 }, { x: 360, y: 920 },
        { x: 360, y: 1000 },
      ],
      tiles: [
        { x: 300, y: 260 }, { x: 680, y: 260 }, { x: 60, y: 260 },
        { x: 300, y: 530 }, { x: 680, y: 530 }, { x: 60, y: 530 },
        { x: 300, y: 790 }, { x: 440, y: 790 }, { x: 680, y: 790 },
        { x: 240, y: 960 }, { x: 520, y: 1010 }, { x: 600, y: 1030 },
      ],
      lantern: { x: 360, y: 1000 },
      flyerSpawns: [{ x: 760, y: 240 }, { x: -60, y: 600 }, { x: 760, y: 900 }],
    },
    waves: L4_WAVES,
    startGold: 200,
    lanternHp: 20,
    towers: ['ember', 'halo', 'prism', 'kiln'],
    roster: ['runner', 'swarm', 'shielded', 'flyer', 'healer'],
    runes: true,
    hpMult: 0.95,
  },
  {
    id: 5,
    name: 'The Bramble Maze',
    map: {
      waypoints: [
        { x: 360, y: -60 }, { x: 360, y: 160 }, { x: 140, y: 160 }, { x: 140, y: 380 },
        { x: 580, y: 380 }, { x: 580, y: 600 }, { x: 140, y: 600 }, { x: 140, y: 820 },
        { x: 580, y: 820 }, { x: 580, y: 1000 }, { x: 360, y: 1000 },
      ],
      tiles: [
        { x: 240, y: 280 }, { x: 460, y: 240 }, { x: 40, y: 270 },
        { x: 460, y: 490 }, { x: 100, y: 490 }, { x: 680, y: 490 },
        { x: 460, y: 710 }, { x: 40, y: 710 }, { x: 680, y: 660 },
        { x: 460, y: 930 }, { x: 240, y: 930 },
      ],
      lantern: { x: 360, y: 1000 },
      flyerSpawns: [{ x: 760, y: 300 }, { x: -60, y: 700 }, { x: 360, y: -80 }],
    },
    waves: L5_WAVES,
    startGold: 190,
    lanternHp: 21,
    towers: ['ember', 'halo', 'prism', 'kiln'],
    roster: ['runner', 'swarm', 'shielded', 'flyer', 'healer'],
    runes: true,
    hpMult: 1,
  },
  {
    id: 6,
    name: 'The Wisp Woods',
    map: {
      waypoints: [
        { x: -60, y: 200 }, { x: 480, y: 200 }, { x: 480, y: 440 }, { x: 240, y: 440 },
        { x: 240, y: 680 }, { x: 600, y: 680 }, { x: 600, y: 920 }, { x: 360, y: 920 },
        { x: 360, y: 1000 },
      ],
      // tile PAIRS sit ~120px apart — Wisp Grove range covers a partner
      tiles: [
        { x: 280, y: 320 }, { x: 400, y: 320 }, { x: 140, y: 320 },
        { x: 200, y: 560 }, { x: 320, y: 560 }, { x: 680, y: 620 },
        { x: 200, y: 800 }, { x: 460, y: 790 }, { x: 580, y: 790 },
        { x: 360, y: 860 }, { x: 240, y: 960 }, { x: 480, y: 990 },
      ],
      lantern: { x: 360, y: 1000 },
      flyerSpawns: [{ x: 760, y: 260 }, { x: -60, y: 760 }, { x: 360, y: -80 }],
    },
    waves: L6_WAVES,
    startGold: 200,
    lanternHp: 21,
    towers: ['ember', 'halo', 'prism', 'kiln', 'grove'],
    roster: ['runner', 'swarm', 'shielded', 'flyer', 'healer', 'miniboss'],
    runes: true,
    hpMult: 1,
  },
  {
    id: 7,
    name: 'The Old Paths',
    map: {
      // 2026-11-09 redesign (operator: "path is crossing the lantern"): high
      // spiral — the path never dips below y=760 and the lantern moved UP to
      // (320,620) as a clean terminal endpoint no leg crosses. 3020px (−20%);
      // the bottom third is dedicated build space and the old button-zone
      // tile (360,1120) is gone (closes the L7 half of the tile-zone flag).
      waypoints: [
        { x: -60, y: 180 }, { x: 620, y: 180 }, { x: 620, y: 760 }, { x: 140, y: 760 },
        { x: 140, y: 380 }, { x: 560, y: 380 }, { x: 560, y: 620 }, { x: 320, y: 620 },
      ],
      tiles: [
        { x: 300, y: 300 }, { x: 500, y: 300 }, { x: 680, y: 300 },
        { x: 680, y: 480 }, { x: 60, y: 600 }, { x: 240, y: 510 },
        { x: 480, y: 500 }, { x: 240, y: 660 }, { x: 300, y: 840 },
        { x: 200, y: 860 }, { x: 480, y: 900 },
      ],
      lantern: { x: 320, y: 620 },
      flyerSpawns: [{ x: 760, y: 500 }, { x: -60, y: 300 }, { x: 360, y: -80 }],
    },
    waves: L7_WAVES,
    startGold: 210,
    lanternHp: 22,
    towers: ['ember', 'halo', 'prism', 'kiln', 'grove'],
    roster: ['runner', 'swarm', 'shielded', 'flyer', 'healer'],
    runes: true,
    hpMult: 1.05,
  },
  {
    id: 8,
    name: 'The Silent Grove',
    map: {
      // 2026-11-11 rework (operator picked variant C of 3): the old symmetric
      // 3-pass ladder boxed the lantern in — legs passed 40px above it on both
      // sides. Now: staggered switchbacks (four passes of different widths,
      // two distinct left columns) ending in a clean vertical drop into the
      // WEST HOLLOW — lantern (140,1000), no leg grazes it. 2560px (+4%,
      // length kept as promised). Grove pair t4+t5 sits 120px apart mid-map.
      // The old (480,1080) tile grazed the strip zone — the new lowest tile
      // is (300,960), legal (y<1040, off-strip).
      // 2026-11-11 (later): t12 (20,940) HOLLOW WATCH added — ON the left
      // flyer lane (d≈63, ember chord ~270px), legal off the ground path,
      // 113px from t11. The short left lane was the 0-leak blocker: only t11
      // reached it (t10 ember 150 < 165 needed). t12 profiles 5% path / 73%
      // fly — a lane specialist, not a filler. With the full-depth threestar
      // doctrine this makes 0-leak attainable: min-leak 0, 8/30 perfect runs
      // @30 seeds, waves untouched. 13 tiles.
      waypoints: [
        { x: 360, y: -60 }, { x: 360, y: 200 }, { x: 600, y: 200 }, { x: 600, y: 440 },
        { x: 160, y: 440 }, { x: 160, y: 700 }, { x: 560, y: 700 }, { x: 560, y: 900 },
        { x: 140, y: 900 }, { x: 140, y: 1000 },
      ],
      tiles: [
        { x: 300, y: 100 }, { x: 480, y: 320 }, { x: 300, y: 320 },
        { x: 60, y: 560 }, { x: 300, y: 560 }, { x: 420, y: 560 },
        { x: 660, y: 560 }, { x: 300, y: 780 }, { x: 480, y: 780 },
        { x: 660, y: 820 }, { x: 300, y: 960 }, { x: 100, y: 860 },
        { x: 20, y: 940 },
      ],
      lantern: { x: 140, y: 1000 },
      flyerSpawns: [{ x: 760, y: 240 }, { x: -60, y: 720 }, { x: 360, y: -80 }],
    },
    waves: L8_WAVES,
    startGold: 240,
    lanternHp: 26,
    towers: ['ember', 'halo', 'prism', 'kiln', 'grove'],
    roster: ['runner', 'swarm', 'shielded', 'flyer', 'healer'],
    runes: true,
    hpMult: 1,
  },
  {
    id: 9,
    name: 'The Rootways',
    map: {
      waypoints: [
        { x: -60, y: 120 }, { x: 540, y: 120 }, { x: 540, y: 300 }, { x: 180, y: 300 },
        { x: 180, y: 480 }, { x: 600, y: 480 }, { x: 600, y: 660 }, { x: 180, y: 660 },
        { x: 180, y: 840 }, { x: 600, y: 840 }, { x: 600, y: 1000 }, { x: 360, y: 1000 },
      ],
      // 2026-11-11: t12 (480,1120) removed — it overlapped the wave-strip /
      // button zone (no build tiles y≳1080 in x 126-594, W4.0-3). It was the
      // weakest tile anyway (5% path coverage); the bottom lane it watched is
      // already covered by t11 (360,930). 13 → 12 tiles.
      tiles: [
        { x: 300, y: 210 }, { x: 100, y: 210 }, { x: 360, y: 390 },
        { x: 100, y: 390 }, { x: 240, y: 570 }, { x: 360, y: 570 },
        { x: 100, y: 570 }, { x: 680, y: 570 }, { x: 360, y: 750 },
        { x: 100, y: 750 }, { x: 680, y: 750 }, { x: 360, y: 930 },
      ],
      lantern: { x: 360, y: 1000 },
      flyerSpawns: [{ x: 760, y: 600 }, { x: -60, y: 400 }, { x: 360, y: -80 }],
    },
    waves: L9_WAVES,
    startGold: 230,
    lanternHp: 24,
    towers: ['ember', 'halo', 'prism', 'kiln', 'grove'],
    roster: ['runner', 'swarm', 'shielded', 'flyer', 'healer'],
    runes: true,
    hpMult: 1.15,
  },
  {
    id: 10,
    name: 'The Heartwood',
    map: {
      waypoints: [
        { x: 360, y: -60 }, { x: 360, y: 180 }, { x: 600, y: 180 }, { x: 600, y: 860 },
        { x: 120, y: 860 }, { x: 120, y: 440 }, { x: 360, y: 440 }, { x: 360, y: 1000 },
      ],
      // the (280/280/420, ~700-840) triple flanks the final spire run —
      // the arena's natural grove nest for the finale. t5 sits under the
      // left run, clear of the wave-strip / start-button zone (never below
      // y≈1080 between x 126-594 — W4.0-3)
      tiles: [
        { x: 480, y: 300 }, { x: 240, y: 300 }, { x: 240, y: 120 },
        { x: 680, y: 620 }, { x: 680, y: 900 }, { x: 180, y: 980 },
        { x: 240, y: 900 }, { x: 240, y: 560 }, { x: 480, y: 620 },
        { x: 280, y: 700 }, { x: 280, y: 840 }, { x: 420, y: 770 },
      ],
      lantern: { x: 360, y: 1000 },
      flyerSpawns: [{ x: 760, y: 500 }, { x: -60, y: 700 }, { x: 360, y: -80 }],
    },
    waves: L10_WAVES,
    startGold: 280,
    lanternHp: 26,
    towers: ['ember', 'halo', 'prism', 'kiln', 'grove'],
    roster: ['runner', 'swarm', 'shielded', 'flyer', 'healer', 'boss', 'miniboss', 'heartwood'],
    runes: true,
    hpMult: 1.2,
  },
];

/** The full-bestiary map used by daily & endless runs (flagged via LevelDef.bestiary). */
export const BESTIARY_LEVEL: LevelDef = LEVELS.find((l) => l.bestiary) ?? LEVELS[0];

/** Endless composition beyond a level's table — deterministic per seed,
 * filtered to the level's roster. Boss-family kinds never roll randomly;
 * they arrive on the fixed over-wave cadence below. */
function endlessGroups(level: LevelDef, wave: number, rng: Rng): SpawnGroup[] {
  const over = wave - level.waves.length;
  const groups: SpawnGroup[] = [];
  const pool = level.roster.filter((k) => !BOSS_LIKES.has(k));
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
  if (over % 10 === 5 && level.roster.includes('miniboss')) {
    groups.push({ kind: 'miniboss', count: 2, gap: 5, delay: 4 });
  }
  return groups;
}

export function waveGroups(level: LevelDef, wave: number, rng: Rng): SpawnGroup[] {
  if (wave <= level.waves.length) return level.waves[wave - 1];
  return endlessGroups(level, wave, rng);
}

// ---------- Runes (roguelite picks after every 5th wave) ----------

/** What a rune DOES — one table drives behaviour (runes.ts queries),
 * instant application (GameScene.applyRune) and the offer pool. (M2)
 *  - stat: a multiplier on a named stat slot (stacking multiplicatively)
 *  - flag: enables a behaviour (queried as a boolean)
 *  - instant: applied once when claimed */
export type RuneStat =
  | 'rate' | 'range' | 'prismDmg' | 'splash' | 'slow' | 'bounty' | 'cost'
  | 'emberRate' | 'beamWidth' | 'kilnDmg' | 'groveRange' | 'groveGain';

export type RuneEffect =
  | { kind: 'stat'; stat: RuneStat; mult: number }
  | { kind: 'flag'; flag: 'chains' | 'slowBurn' }
  | { kind: 'instant'; apply: 'sturdy' | 'fortune' };

export interface RuneDef {
  id: RuneId;
  name: string;
  desc: string;
  accent: number; // display colour
  glyph: 'ember' | 'prism' | 'halo' | 'kiln' | 'grove' | 'heart' | 'coinStack' | 'sparkle' | 'bolt' | 'hand' | 'eye' | 'snow';
  effect: RuneEffect;
  /** Set when the rune modifies ONE specific tower: only offered while that
 * tower is in the level's roster (no dead picks like Volatile Kiln on
 * levels without the Kiln). */
  tower?: TowerKind;
}

export const RUNES: RuneDef[] = [
  { id: 'emberChains', name: 'Spark Chains', desc: 'Ember hits leap to 2 nearby foes at 50% damage.', accent: 0xffc24b, glyph: 'ember', tower: 'ember', effect: { kind: 'flag', flag: 'chains' } },
  { id: 'focusLens', name: 'Focus Lens', desc: 'Prism Beam damage +35%.', accent: 0x4fd8eb, glyph: 'prism', tower: 'prism', effect: { kind: 'stat', stat: 'prismDmg', mult: 1.35 } },
  { id: 'slowBurn', name: 'Slow Burn', desc: 'Halo auras ignite: +8 damage per second.', accent: 0x9b8cff, glyph: 'halo', tower: 'halo', effect: { kind: 'flag', flag: 'slowBurn' } },
  { id: 'volatile', name: 'Volatile Kiln', desc: 'Kiln splash radius +35%.', accent: 0xff8b4b, glyph: 'kiln', tower: 'kiln', effect: { kind: 'stat', stat: 'splash', mult: 1.35 } },
  { id: 'overcharge', name: 'Overcharge', desc: 'All towers fire 15% faster.', accent: 0xdce4f5, glyph: 'bolt', effect: { kind: 'stat', stat: 'rate', mult: 1.15 } },
  { id: 'greed', name: 'Greed', desc: 'All bounties +30%.', accent: 0xefcfa0, glyph: 'coinStack', effect: { kind: 'stat', stat: 'bounty', mult: 1.3 } },
  { id: 'sturdy', name: 'Sturdy Heart', desc: 'Lantern +8 max HP and fully refilled.', accent: 0xff6b7a, glyph: 'heart', effect: { kind: 'instant', apply: 'sturdy' } },
  { id: 'swift', name: 'Swift Hands', desc: 'Build & upgrade costs −12%.', accent: 0xefcfa0, glyph: 'hand', effect: { kind: 'stat', stat: 'cost', mult: 0.88 } },
  { id: 'farsight', name: 'Long Sight', desc: 'All tower range +12%.', accent: 0xdce4f5, glyph: 'eye', effect: { kind: 'stat', stat: 'range', mult: 1.12 } },
  { id: 'coldHeart', name: 'Cold Heart', desc: 'Halo slow deepens (foes crawl 20% slower).', accent: 0x4fd8eb, glyph: 'snow', tower: 'halo', effect: { kind: 'stat', stat: 'slow', mult: 0.8 } },
  { id: 'fortune', name: 'Fortune', desc: 'Gain 80 gold immediately.', accent: 0xefcfa0, glyph: 'sparkle', effect: { kind: 'instant', apply: 'fortune' } },
  // ---- second variants: every tower offers at least two exclusive picks ----
  { id: 'quickspark', name: 'Quickspark', desc: 'Ember Spire fires 25% faster.', accent: 0xffc24b, glyph: 'bolt', tower: 'ember', effect: { kind: 'stat', stat: 'emberRate', mult: 1.25 } },
  { id: 'wideLens', name: 'Wide Lens', desc: 'Prism beams are 45% wider, catching whole columns.', accent: 0x4fd8eb, glyph: 'eye', tower: 'prism', effect: { kind: 'stat', stat: 'beamWidth', mult: 1.45 } },
  { id: 'powderKeg', name: 'Powder Keg', desc: 'Kiln damage +30%.', accent: 0xff8b4b, glyph: 'kiln', tower: 'kiln', effect: { kind: 'stat', stat: 'kilnDmg', mult: 1.3 } },
  { id: 'deepRoots', name: 'Deep Roots', desc: 'Wisp Grove reach +30%.', accent: 0x47e0a0, glyph: 'grove', tower: 'grove', effect: { kind: 'stat', stat: 'groveRange', mult: 1.3 } },
  { id: 'oldGrowth', name: 'Old Growth', desc: 'Wisp Grove empower is 50% stronger.', accent: 0x47e0a0, glyph: 'sparkle', tower: 'grove', effect: { kind: 'stat', stat: 'groveGain', mult: 1.5 } },
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
  bossHpRamp: 0.05, bossHpAnchorWave: 10, // boss-family hp = 1 + ramp * (wave - anchor)
  // Heartwood Murk — Root & Sprout: crossing an HP fraction threshold roots
  // it (full stop, bar flashes — the burst window) and sprouts a runner pack
  // behind it; the crawl quickens each phase. The bar IS the fight script
  // (no timer summons).
  heartwoodPhases: [0.75, 0.5, 0.25],
  heartwoodRootMs: 3500,
  heartwoodPack: [3, 4, 5],
  heartwoodPhaseSpeed: 1.15, // crawl multiplier per phase crossed
  heartwoodRootSplashMult: 0.5, // bark hardens while rooted: splash damage ×0.5
                                  // (beams/sparks keep full value — the focus-fire window)
  summonTrailPx: 44, // sprout-pack trail spacing behind the boss
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

// ---------- Background music (per-biome, procedural — see src/audio.ts) ----------
// One MusicDef per biome track; the scheduler plays chords + melody on an
// 8th-note grid with a shared echo bus. Note names ('F3', 'C#4') are parsed
// to Hz in audio.ts. Melody notes stay >= 440Hz so they never mask combat
// cues; chords are lowpassed triangles below that.
export interface MusicDef {
  bpm: number;
  /** One chord per bar (4 bars/loop), voiced low→high. */
  chords: string[][];
  /** Chord voice (lowpassed triangle in every track so far). */
  chordVol: number;
  chordAttack: number;
  chordFilter: number;
  chordSend: number;
  /** Melody: [bar, eighth-slot, note, duration in 8ths]. */
  melody: [number, number, string, number][];
  melVol: number;
  melAttack: number;
  melSend: number;
  /** Shared echo bus: [delayTime s, feedback, wet]. */
  echo: [number, number, number];
  /** Ambient bus level. */
  busLevel: number;
  /** Every Nth loop the melody thins one note (slot%11===3) — beats repetition. */
  thinEvery: number;
}

// woodlands — the operator-locked pick (auditioned 2026-11-12 as "descent"):
// Fmaj7 → Em7 → Dm7 → Cmaj7 stepping down at 66 BPM, sparse sine melody
// floating above. Values transcribed byte-identical from the auditioned code.
export const MUSIC: Record<string, MusicDef> = {
  woodlands: {
    bpm: 66,
    chords: [
      ['F3', 'A3', 'C4', 'E4'], // Fmaj7
      ['E3', 'G3', 'B3', 'D4'], // Em7
      ['D3', 'F3', 'A3', 'C4'], // Dm7
      ['C3', 'E3', 'G3', 'B3'], // Cmaj7
    ],
    chordVol: 0.021, chordAttack: 0.45, chordFilter: 760, chordSend: 0.35,
    melody: [
      [0, 2.5, 'A5', 2], [0, 5.0, 'E5', 1.5], [0, 7.0, 'C5', 1],
      [1, 0.5, 'G5', 1.5], [1, 3.0, 'D5', 1.5], [1, 6.0, 'B4', 2],
      [2, 1.5, 'F5', 1.5], [2, 4.0, 'A5', 1], [2, 6.5, 'E5', 2],
      [3, 0.0, 'E5', 1], [3, 3.5, 'G5', 1.5], [3, 6.0, 'C5', 2],
    ],
    melVol: 0.04, melAttack: 0.03, melSend: 0.5,
    echo: [0.34, 0.32, 0.5],
    busLevel: 0.8,
    thinEvery: 2,
  },
  // deepmarsh — DRAFT (compose properly during the Deepmarsh session): murky,
  // slower Dm9 → Bbmaj7 → Fadd9 → Am7 in a darker, lower register.
  deepmarsh: {
    bpm: 60,
    chords: [
      ['D3', 'F3', 'C4', 'E4'], // Dm9 (no A — open voicing)
      ['Bb2', 'D3', 'F3', 'A3'], // Bbmaj7
      ['F3', 'A3', 'C4', 'G4'], // Fadd9
      ['A2', 'E3', 'G3', 'C4'], // Am7
    ],
    chordVol: 0.02, chordAttack: 0.55, chordFilter: 640, chordSend: 0.38,
    melody: [
      [0, 1.5, 'F5', 2], [0, 5.0, 'D5', 1.5],
      [1, 0.0, 'C5', 1], [1, 3.5, 'F5', 1.5], [1, 6.5, 'A5', 1.5],
      [2, 2.0, 'G5', 1.5], [2, 5.5, 'E5', 1.5],
      [3, 1.0, 'D5', 1.5], [3, 4.5, 'C5', 1], [3, 6.5, 'A4', 2],
    ],
    melVol: 0.038, melAttack: 0.04, melSend: 0.52,
    echo: [0.38, 0.36, 0.52],
    busLevel: 0.8,
    thinEvery: 2,
  },
  // ashen — DRAFT (compose properly during the Ashen Wastes session): dry,
  // hollow Phrygian rub Em7 → Fmaj7 → Cmaj7(#11) → Bm7, driest echo of the three.
  ashen: {
    bpm: 63,
    chords: [
      ['E3', 'G3', 'B3', 'D4'], // Em7
      ['F3', 'A3', 'C4', 'E4'], // Fmaj7 (the Phrygian E→F rub)
      ['C3', 'G3', 'B3', 'F#4'], // Cmaj7(#11)
      ['B2', 'F#3', 'A3', 'D4'], // Bm7
    ],
    chordVol: 0.02, chordAttack: 0.5, chordFilter: 700, chordSend: 0.3,
    melody: [
      [0, 2.0, 'E5', 1.5], [0, 5.5, 'D5', 1.5],
      [1, 0.5, 'A5', 1.5], [1, 4.0, 'G5', 1],
      [2, 2.5, 'F#5', 1.5], [2, 6.0, 'E5', 1],
      [3, 1.0, 'D5', 1], [3, 3.5, 'B4', 1.5], [3, 6.0, 'A4', 2],
    ],
    melVol: 0.038, melAttack: 0.03, melSend: 0.45,
    echo: [0.3, 0.28, 0.42],
    busLevel: 0.8,
    thinEvery: 2,
  },
};

/** Biome → background-music track (levels default to woodlands). */
export const BIOME_MUSIC: Record<'woodlands' | 'deepmarsh' | 'ashen', string> = {
  woodlands: 'woodlands',
  deepmarsh: 'deepmarsh',
  ashen: 'ashen',
};
