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

  // ================= Level 4 — The Fog Hollow (healer debut) =================
  {
    level: 4,
    name: 'meta',
    desc: 'prism lane + kiln for the packs, mid-lane watch tile',
    steps: [
      b(3, 'ember'), b(0, 'prism'), b(6, 'halo'), up(3),
      b(10, 'kiln'), up(0), b(5, 'ember'), b(8, 'ember'),
      up(6), b(4, 'prism'), up(3), up(10), b(1, 'ember'),
      up(0), b(9, 'ember'), b(7, 'ember'), up(5), up(8),
      up(6), b(11, 'prism'), up(10), up(1), up(9), up(7), up(11), up(4),
    ],
    runePriority: ['focusLens', 'overcharge', 'greed', 'powderKeg', 'emberChains', 'slowBurn', 'sturdy', 'fortune'],
  },
  {
    level: 4,
    name: 'solid',
    desc: 'halo-heavy, late prism, meh spots',
    steps: [
      b(3, 'halo'), b(0, 'ember'), b(6, 'halo'), up(0),
      b(10, 'ember'), b(5, 'prism'), up(3), b(8, 'kiln'),
      up(6), b(2, 'ember'), up(10), b(4, 'prism'),
      up(0), up(5), up(8), up(3), up(2), up(10),
    ],
    runePriority: ['greed', 'overcharge', 'focusLens', 'sturdy', 'fortune'],
  },
  {
    level: 4,
    name: 'weak',
    desc: 'ember trio, ignores healers',
    steps: [b(3, 'ember'), b(0, 'ember'), b(6, 'ember'), up(3), b(9, 'ember')],
    runePriority: ['sturdy', 'fortune'],
  },

  // ================= Level 5 — The Bramble Maze (swarm flood) =================
  {
    level: 5,
    name: 'meta',
    desc: 'halo corners + double kiln for the flood',
    steps: [
      b(3, 'halo'), b(0, 'kiln'), up(0), b(6, 'kiln'),
      up(3), b(9, 'halo'), b(5, 'ember'), up(0),
      b(10, 'ember'), up(6), b(2, 'ember'), up(9),
      b(4, 'ember'), up(3), b(7, 'prism'), up(5),
      up(10), up(2), up(4), up(7), up(9),
    ],
    runePriority: ['volatile', 'overcharge', 'greed', 'powderKeg', 'slowBurn', 'focusLens', 'emberChains', 'sturdy', 'fortune'],
  },
  {
    level: 5,
    name: 'solid',
    desc: 'ember wall, one kiln, late halo',
    steps: [
      b(0, 'ember'), b(3, 'ember'), up(0), b(6, 'halo'),
      b(9, 'ember'), up(3), b(5, 'kiln'), up(6),
      b(10, 'ember'), b(2, 'ember'), up(9), up(5),
      up(10), up(0), up(2), up(3),
    ],
    runePriority: ['greed', 'overcharge', 'volatile', 'sturdy', 'fortune'],
  },
  {
    level: 5,
    name: 'weak',
    desc: 'single-target only into a swarm level',
    steps: [b(0, 'ember'), b(3, 'ember'), up(0), b(9, 'ember')],
    runePriority: ['sturdy', 'fortune'],
  },

  // ================= Level 6 — The Wisp Woods (grove debut + miniboss) =================
  {
    level: 6,
    name: 'meta',
    desc: 'groves on both clusters, kiln for the miniboss waves',
    steps: [
      b(1, 'ember'), b(4, 'ember'), b(3, 'grove'), up(1),
      b(7, 'kiln'), up(4), b(8, 'grove'), b(0, 'prism'),
      up(7), b(9, 'ember'), up(0), b(11, 'halo'),
      up(9), b(10, 'ember'), up(3), up(8),
      up(7), up(0), up(9), up(10), up(11), up(1), up(4),
    ],
    runePriority: ['overcharge', 'greed', 'deepRoots', 'oldGrowth', 'volatile', 'powderKeg', 'focusLens', 'emberChains', 'slowBurn', 'sturdy', 'fortune'],
  },
  {
    level: 6,
    name: 'solid',
    desc: 'strong towers, grove planted late & alone',
    steps: [
      b(1, 'ember'), b(4, 'ember'), up(1), b(7, 'kiln'),
      up(4), b(0, 'halo'), b(9, 'ember'), b(8, 'grove'),
      up(7), b(11, 'prism'), up(0), b(2, 'ember'),
      up(9), up(8), up(1), up(4), up(11), up(7),
    ],
    runePriority: ['greed', 'overcharge', 'volatile', 'focusLens', 'sturdy', 'fortune'],
  },
  {
    level: 6,
    name: 'weak',
    desc: 'pre-grove habits, no answer to the miniboss',
    steps: [b(1, 'ember'), b(4, 'halo'), b(7, 'ember'), up(1), b(9, 'ember')],
    runePriority: ['sturdy', 'fortune'],
  },

  // ================= Level 7 — The Old Paths (long spiral) =================
  {
    level: 7,
    name: 'meta',
    desc: 'prism lanes on the straights, halo on the far corners',
    steps: [
      b(4, 'prism'), b(9, 'halo'), b(1, 'prism'), up(4),
      b(8, 'kiln'), up(1), b(6, 'ember'), b(2, 'ember'),
      up(9), b(5, 'halo'), up(8), b(7, 'prism'),
      b(3, 'prism'), up(4), up(1), b(0, 'ember'),
      up(6), up(2), up(5), up(7), up(3), up(0), up(8), up(9),
    ],
    runePriority: ['focusLens', 'overcharge', 'greed', 'wideLens', 'volatile', 'powderKeg', 'emberChains', 'slowBurn', 'sturdy', 'fortune'],
  },
  {
    level: 7,
    name: 'solid',
    desc: 'halo+ember ring, prisms late',
    steps: [
      b(4, 'halo'), b(9, 'ember'), b(1, 'halo'), up(9),
      b(8, 'ember'), b(6, 'ember'), up(4), b(2, 'prism'),
      b(5, 'grove'), up(1), up(8), up(6), b(7, 'ember'),
      up(2), up(7), up(9), up(5),
    ],
    runePriority: ['greed', 'overcharge', 'focusLens', 'sturdy', 'fortune'],
  },
  {
    level: 7,
    name: 'weak',
    desc: 'two towers for a 3780px walk',
    steps: [b(4, 'ember'), b(9, 'halo'), b(1, 'ember'), up(4)],
    runePriority: ['sturdy', 'fortune'],
  },

  // ================= Level 8 — The Silent Grove (switchback) =================
  {
    level: 8,
    name: 'meta',
    desc: 'central kilns, grove on the top cluster, mid-lane watch',
    steps: [
      b(5, 'kiln'), b(2, 'halo'), b(3, 'grove'), up(5),
      b(0, 'ember'), up(2), b(6, 'kiln'), b(7, 'ember'),
      up(5), b(1, 'prism'), up(0), b(11, 'kiln'),
      b(9, 'ember'), up(6), up(7), up(2), up(0),
      up(9), up(1), b(8, 'ember'), up(11), up(3), up(6), up(8),
    ],
    runePriority: ['volatile', 'powderKeg', 'overcharge', 'greed', 'focusLens', 'emberChains', 'slowBurn', 'sturdy', 'fortune'],
  },
  {
    level: 8,
    name: 'solid',
    desc: 'ember-heavy, one kiln, no grove',
    steps: [
      b(5, 'ember'), b(2, 'ember'), up(5), b(6, 'halo'),
      b(0, 'ember'), up(2), b(4, 'kiln'), b(11, 'ember'),
      up(0), b(9, 'ember'), up(6), up(4), up(5),
      up(2), up(11), up(9),
    ],
    runePriority: ['greed', 'overcharge', 'volatile', 'sturdy', 'fortune'],
  },
  {
    level: 8,
    name: 'weak',
    desc: 'top-half builds only',
    steps: [b(2, 'ember'), b(5, 'halo'), b(3, 'ember'), up(2), b(6, 'ember')],
    runePriority: ['sturdy', 'fortune'],
  },

  // ================= Level 9 — The Rootways (attrition) =================
  {
    level: 9,
    name: 'meta',
    desc: 'grove mid-map, prism ends, kiln center',
    steps: [
      b(5, 'ember'), b(2, 'halo'), b(4, 'grove'), b(8, 'kiln'),
      up(5), up(2), b(0, 'ember'), b(11, 'prism'),
      up(8), b(3, 'ember'), b(9, 'ember'), up(0),
      b(7, 'prism'), up(11), b(12, 'halo'), b(10, 'ember'),
      up(5), up(2), up(0), b(1, 'ember'), up(8),
      up(3), up(9), up(11), up(10), up(7), up(12), up(4),
    ],
    runePriority: ['overcharge', 'greed', 'volatile', 'powderKeg', 'focusLens', 'oldGrowth', 'deepRoots', 'emberChains', 'slowBurn', 'sturdy', 'swift', 'fortune'],
  },
  {
    level: 9,
    name: 'solid',
    desc: 'full map, wrong spots, slow upgrades',
    steps: [
      b(5, 'ember'), b(2, 'ember'), b(8, 'halo'), b(0, 'kiln'),
      b(11, 'ember'), b(4, 'prism'), b(9, 'ember'), b(3, 'halo'),
      b(7, 'ember'), b(12, 'ember'), b(10, 'prism'), b(1, 'ember'),
      up(5), up(2), up(8), up(0), up(11), up(9),
      up(4), up(7), up(3),
    ],
    runePriority: ['greed', 'overcharge', 'volatile', 'focusLens', 'sturdy', 'swift', 'farsight', 'fortune'],
  },
  {
    level: 9,
    name: 'weak',
    desc: 'half map, no plan',
    steps: [b(5, 'ember'), b(2, 'halo'), b(8, 'ember'), up(5), b(0, 'ember'), up(2)],
    runePriority: ['sturdy', 'fortune'],
  },

  // ================= Level 10 — The Heartwood (the finale) =================
  {
    level: 10,
    name: 'meta',
    desc: 'grove nest by the spire, kilns for the summoned packs',
    steps: [
      b(7, 'ember'), b(6, 'halo'), up(7), b(9, 'kiln'),
      b(10, 'grove'), up(9), b(0, 'prism'), b(4, 'ember'),
      up(7), b(3, 'ember'), b(11, 'ember'), up(0),
      b(8, 'prism'), up(9), up(6), b(5, 'kiln'),
      b(2, 'ember'), up(3), up(11), up(0), up(8),
      up(5), up(2), up(10), up(6), up(9),
    ],
    runePriority: ['overcharge', 'greed', 'volatile', 'powderKeg', 'oldGrowth', 'deepRoots', 'focusLens', 'emberChains', 'slowBurn', 'sturdy', 'fortune'],
  },
  {
    level: 10,
    name: 'solid',
    desc: 'ring defense, no spire nest',
    steps: [
      b(7, 'ember'), b(6, 'halo'), up(7), b(0, 'prism'),
      b(3, 'ember'), up(6), b(9, 'halo'), b(4, 'kiln'),
      b(8, 'ember'), up(0), b(5, 'ember'), b(2, 'prism'),
      up(7), up(3), up(9), up(8), up(4), up(5),
    ],
    runePriority: ['greed', 'overcharge', 'volatile', 'focusLens', 'sturdy', 'fortune'],
  },
  {
    level: 10,
    name: 'weak',
    desc: 'no grove, no kilns — the Heartwood walks',
    steps: [b(7, 'ember'), b(6, 'halo'), b(0, 'prism'), up(7), b(3, 'ember'), up(0)],
    runePriority: ['sturdy', 'fortune'],
  },
];
