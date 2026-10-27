// Build policies for the balance simulator — scripted "player skill" levels.
// Each policy is a build/upgrade order executed as soon as it's affordable
// (during prep and mid-wave), plus a rune pick priority.
//
// "meta" = the best build DISCOVERED SO FAR (it moves as we learn — on
// The Descent the discovery was that halo slows & kiln splash both beat
// raw ember DPS; the cdp-bot replays these plans against the real game).
// Tune the WAVES in src/config.ts until the bands hold:
//   meta    → clears ~90% (hard level) / comfortably (mid level)
//   solid   → full-map but mediocre mix/spots — clears hurt or coin-flips
//   middling→ novice pattern (no buy prioritization) — coin-flip on the
//             hard level, comfortable elsewhere
//   weak    → loses mid-level — punishes thoughtless play
import { TowerKind } from '../src/config';

export type Step = { build: [number, TowerKind] } | { up: number };

export interface Policy {
  level: number;
  name: string;
  desc: string;
  steps: Step[];
  runePriority: string[];
}

const up = (n: number): Step => ({ up: n });
const b = (tile: number, kind: TowerKind): Step => ({ build: [tile, kind] });

export const POLICIES: Policy[] = [
  // ================= Level 1 — The Crossing (reference: fun-validated) =================
  {
    level: 1,
    name: 'meta',
    desc: 'central ember pair + halos on the bends',
    steps: [
      b(3, 'ember'), b(4, 'halo'), b(7, 'ember'), up(3),
      b(9, 'ember'), b(8, 'halo'), up(4), up(7), up(9),
      b(1, 'ember'), up(3), up(8), up(1), up(4), up(9),
    ],
    runePriority: ['overcharge', 'emberChains', 'greed', 'slowBurn', 'sturdy', 'fortune'],
  },
  {
    level: 1,
    name: 'solid',
    desc: 'decent spots, slower upgrades',
    steps: [b(3, 'ember'), b(4, 'halo'), b(9, 'ember'), up(3), b(7, 'halo'), up(9), b(1, 'ember'), up(4), b(5, 'ember'), up(1), up(7), b(12, 'ember')],
    runePriority: ['greed', 'overcharge', 'sturdy', 'fortune'],
  },
  {
    level: 1,
    name: 'weak',
    desc: 'two towers, no upgrades',
    steps: [b(0, 'ember'), b(9, 'ember')],
    runePriority: ['sturdy', 'fortune'],
  },

  // ================= Level 2 — The Long Watch =================
  {
    level: 2,
    name: 'meta',
    desc: 'prisms vs shielded, flyer wall on 7/8/5',
    steps: [
      b(0, 'ember'), b(1, 'prism'), b(4, 'halo'), up(0),
      b(7, 'prism'), b(6, 'ember'), up(1), up(7),
      b(8, 'ember'), b(5, 'ember'), b(10, 'halo'), b(3, 'prism'),
      up(0), up(4), up(6), up(1), up(7), up(8), up(3), up(5), up(10),
    ],
    runePriority: ['overcharge', 'focusLens', 'greed', 'emberChains', 'slowBurn', 'swift', 'farsight', 'coldHeart', 'sturdy', 'fortune'],
  },
  {
    level: 2,
    name: 'solid',
    desc: 'halo-heavy, late flyer wall, mediocre spots',
    steps: [
      b(0, 'ember'), b(3, 'halo'), b(1, 'prism'), up(0),
      b(6, 'ember'), b(4, 'halo'), b(7, 'prism'), up(3),
      b(8, 'ember'), b(10, 'halo'), up(1), up(6), up(7),
      b(5, 'ember'), up(0), up(4), up(8), up(10),
    ],
    runePriority: ['greed', 'overcharge', 'focusLens', 'sturdy', 'fortune'],
  },
  {
    level: 2,
    name: 'threestar',
    desc: 'flyer-aware opening: wall on 7/8/9 before wave 6',
    steps: [
      b(7, 'ember'), b(8, 'ember'), b(9, 'ember'), up(7),
      b(1, 'prism'), b(3, 'prism'), b(4, 'halo'), up(8),
      b(0, 'ember'), b(6, 'ember'), b(10, 'halo'), b(5, 'ember'),
      up(9), up(1), up(3), up(0), up(7), up(8),
      up(4), up(6), up(9), up(1), up(3), up(5), up(10),
    ],
    runePriority: ['overcharge', 'focusLens', 'greed', 'emberChains', 'slowBurn', 'swift', 'farsight', 'coldHeart', 'sturdy', 'fortune'],
  },
  {
    level: 2,
    name: 'weak',
    desc: 'ignores prism entirely (armor-blind)',
    steps: [b(0, 'ember'), b(4, 'halo'), b(7, 'ember'), up(0), b(6, 'ember'), up(7), b(8, 'ember')],
    runePriority: ['sturdy', 'fortune'],
  },

  // ================= Level 3 — The Descent =================
  {
    level: 3,
    name: 'meta',
    desc: 'flyer-rush opening on the lane wall, then the full toolkit',
    steps: [
      b(1, 'ember'), b(3, 'halo'), b(10, 'ember'), b(9, 'ember'),
      b(11, 'prism'), b(4, 'ember'), up(1), b(6, 'kiln'),
      b(0, 'prism'), b(7, 'ember'), up(9), up(10), up(3),
      b(2, 'prism'), b(5, 'ember'), b(8, 'kiln'), up(11),
      up(6), up(0), up(4), up(1), up(7), up(2),
      up(5), up(8), up(3), up(9), up(10), up(11), up(6), up(0), up(1),
    ],
    runePriority: ['overcharge', 'greed', 'volatile', 'focusLens', 'emberChains', 'slowBurn', 'swift', 'farsight', 'coldHeart', 'sturdy', 'fortune'],
  },
  {
    level: 3,
    name: 'solid',
    desc: 'fills the map, but kiln-heavy, one halo, prisms on meh spots',
    steps: [
      b(1, 'ember'), b(3, 'halo'), b(6, 'kiln'), up(1),
      b(4, 'prism'), b(0, 'ember'), b(2, 'prism'), up(6),
      b(9, 'ember'), up(3), up(0), b(10, 'kiln'), up(1),
      b(7, 'ember'), b(5, 'ember'), b(8, 'kiln'), up(9),
      up(2), up(6), up(4), up(7), up(10), up(5),
      up(8), up(3), up(9), up(0), up(1),
    ],
    runePriority: ['greed', 'overcharge', 'volatile', 'focusLens', 'sturdy', 'swift', 'farsight', 'fortune'],
  },
  {
    level: 3,
    name: 'middling',
    desc: 'novice pattern: all 11 builds first, upgrades only after',
    steps: [
      b(1, 'ember'), b(3, 'halo'), b(6, 'kiln'),
      b(0, 'prism'), b(9, 'ember'), b(10, 'kiln'),
      b(4, 'ember'), b(2, 'prism'), b(7, 'ember'),
      b(5, 'ember'), b(8, 'kiln'), b(11, 'ember'),
      up(1), up(3), up(6), up(0), up(9), up(10),
      up(4), up(2), up(7), up(5), up(8),
      up(1), up(3), up(6), up(0), up(9), up(10),
    ],
    runePriority: ['greed', 'overcharge', 'volatile', 'focusLens', 'sturdy', 'swift', 'farsight', 'fortune'],
  },
  {
    level: 3,
    name: 'weak',
    desc: 'ember+halo only (L1 habits on the endgame map)',
    steps: [b(1, 'ember'), b(3, 'halo'), b(6, 'ember'), b(4, 'halo'), up(1), b(9, 'ember'), up(3), up(6)],
    runePriority: ['sturdy', 'fortune'],
  },
];
