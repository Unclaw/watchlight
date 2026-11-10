// Build policies for the balance simulator — scripted "player skill" levels.
// Each policy is a build/upgrade order executed as soon as it's affordable
// (during prep and mid-wave), plus a rune pick priority.
//
// "meta" = the best build DISCOVERED SO FAR (it moves as we learn — on
// The Descent the discovery was that halo slows & kiln splash both beat
// raw ember DPS; the cdp-bot replays these plans against the real game).
// Tune the WAVES in src/config.ts until the bands hold:
//   meta     → clears ~90% (hard level) / comfortably (mid level)
//   solid    → full-map but mediocre mix/spots — clears hurt or coin-flips
//   middling → novice pattern (no buy prioritization) — coin-flip on the
//              hard level, comfortable elsewhere
//   threestar→ dedicated 0-leak build (perfect-run ceiling probe): overbuilds
//              coverage where meta's leaks cluster (flyer lanes, healer
//              waves); its perfect-run rate answers "CAN a plan 3-star this
//              level, and how exotic must it be" — runes bias to kill-speed
//              & slow (coldHeart/slowBurn), NOT lantern HP (sturdy doesn't
//              stop leaks)
//   weak     → loses mid-level — punishes thoughtless play
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
    name: 'threestar',
    desc: '0-leak probe: ember wall on the 9/10 fly lanes + prism/healer answer early',
    steps: [
      b(9, 'ember'), b(10, 'ember'), up(9), up(10), b(7, 'prism'),
      b(3, 'halo'), b(11, 'prism'), b(6, 'kiln'),
      b(1, 'ember'), b(0, 'prism'), up(7), b(4, 'ember'),
      b(8, 'kiln'), up(3),
      up(9), up(10), up(7), up(3),
      up(11), up(11), up(6), up(6), up(1), up(1), up(0), up(0), up(4), up(4), up(8), up(8),
    ],
    runePriority: ['coldHeart', 'overcharge', 'focusLens', 'slowBurn', 'emberChains', 'volatile', 'greed', 'swift', 'farsight', 'wideLens', 'powderKeg', 'sturdy', 'fortune'],
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
    name: 'middling',
    desc: 'novice pattern: all 12 builds first, upgrades only after',
    steps: [
      b(0, 'ember'), b(1, 'halo'), b(2, 'prism'), b(3, 'kiln'),
      b(4, 'ember'), b(5, 'halo'), b(6, 'ember'), b(7, 'prism'),
      b(8, 'ember'), b(9, 'halo'), b(10, 'ember'), b(11, 'kiln'),
      up(0), up(1), up(2), up(3), up(4), up(5), up(6), up(7), up(8), up(9), up(10), up(11),
      up(0), up(1), up(2), up(3), up(4), up(5),
    ],
    runePriority: ['greed', 'overcharge', 'focusLens', 'sturdy', 'fortune'],
  },
  {
    level: 4,
    name: 'threestar',
    desc: '0-leak probe: ember pair on the 10/11 fly lanes first, four prisms for the healers',
    steps: [
      b(11, 'ember'), b(10, 'kiln'), b(6, 'prism'), up(11), up(10),
      b(9, 'halo'), b(0, 'kiln'), b(3, 'prism'), b(7, 'prism'),
      b(8, 'ember'), b(5, 'ember'), b(1, 'prism'), b(2, 'ember'),
      up(6), up(6), up(9), up(9), up(0), up(0),
      up(3), up(3), up(7), up(7), up(8), up(8), up(5), up(5), up(1), up(1), up(2), up(2),
    ],
    runePriority: ['coldHeart', 'overcharge', 'focusLens', 'slowBurn', 'emberChains', 'volatile', 'powderKeg', 'greed', 'swift', 'farsight', 'wideLens', 'sturdy', 'fortune'],
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
    name: 'middling',
    desc: 'novice pattern: all 11 builds first, upgrades only after',
    steps: [
      b(0, 'ember'), b(1, 'halo'), b(2, 'prism'), b(3, 'kiln'),
      b(4, 'ember'), b(5, 'ember'), b(6, 'halo'), b(7, 'ember'),
      b(8, 'prism'), b(9, 'ember'), b(10, 'kiln'),
      up(0), up(1), up(2), up(3), up(4), up(5), up(6), up(7), up(8), up(9), up(10),
      up(0), up(1), up(2), up(3), up(4), up(5),
    ],
    runePriority: ['greed', 'overcharge', 'volatile', 'sturdy', 'fortune'],
  },
  {
    level: 5,
    name: 'threestar',
    desc: '0-leak probe: embers on the 10/7 fly lanes, double kiln for the swarm floods',
    steps: [
      b(10, 'ember'), b(7, 'ember'), b(3, 'prism'), b(0, 'kiln'),
      up(10), b(5, 'prism'), b(9, 'halo'), b(6, 'kiln'),
      up(7), up(3), b(2, 'ember'), b(1, 'ember'),
      up(10), up(7), up(3), up(0), up(0), up(6), up(6),
      up(5), up(5), up(9), up(9), up(2), up(2), up(1), up(1),
    ],
    runePriority: ['volatile', 'overcharge', 'coldHeart', 'slowBurn', 'powderKeg', 'focusLens', 'emberChains', 'greed', 'swift', 'farsight', 'wideLens', 'sturdy', 'fortune'],
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
    name: 'middling',
    desc: 'novice pattern: all 12 builds first (grove when discovered), upgrades only after',
    steps: [
      b(0, 'ember'), b(1, 'halo'), b(2, 'prism'), b(3, 'kiln'),
      b(4, 'grove'), b(5, 'ember'), b(6, 'ember'), b(7, 'halo'),
      b(8, 'prism'), b(9, 'ember'), b(10, 'kiln'), b(11, 'ember'),
      up(0), up(1), up(2), up(3), up(4), up(5), up(6), up(7), up(8), up(9), up(10), up(11),
      up(0), up(1), up(2), up(3), up(4), up(5),
    ],
    runePriority: ['greed', 'overcharge', 'volatile', 'focusLens', 'sturdy', 'fortune'],
  },
  {
    level: 6,
    name: 'threestar',
    desc: '0-leak probe: embers on the 10/6 fly lanes, grove pair + kiln for the miniboss',
    steps: [
      b(1, 'ember'), b(4, 'ember'), up(1), b(7, 'kiln'),
      b(10, 'ember'), up(4), b(3, 'grove'), b(6, 'ember'),
      b(8, 'grove'), b(0, 'prism'), up(7), up(10),
      b(9, 'ember'), b(11, 'halo'),
      up(6), up(6), up(3), up(3), up(8), up(8), up(0), up(0),
      up(9), up(9), up(11), up(11), up(1), up(4), up(7), up(10),
    ],
    runePriority: ['coldHeart', 'overcharge', 'slowBurn', 'deepRoots', 'oldGrowth', 'volatile', 'powderKeg', 'focusLens', 'emberChains', 'greed', 'swift', 'farsight', 'sturdy', 'fortune'],
  },
  {
    level: 6,
    name: 'weak',
    desc: 'pre-grove habits, no answer to the miniboss',
    steps: [b(1, 'ember'), b(4, 'halo'), b(7, 'ember'), up(1), b(9, 'ember')],
    runePriority: ['sturdy', 'fortune'],
  },

  // ================= Level 7 — The Old Paths (high spiral, 2026-11-09 remake) =================
  // Tiles: 0(300,300) 1(500,300) 2(680,300) 3(680,480) 4(60,600) 5(240,510,grove-pair with 7)
  //        6(480,500 STAR) 7(240,660) 8(300,840) 9(200,860) 10(480,900). Lantern (320,620).
  {
    level: 7,
    name: 'meta',
    desc: 'grove-fed pocket: ember 7 + kiln 6, halos on B/D legs, full-map fill',
    steps: [
      b(7, 'ember'), b(5, 'grove'), b(6, 'kiln'), up(7),
      b(3, 'halo'), b(4, 'halo'), up(6), b(0, 'kiln'),
      b(1, 'prism'), up(7), up(6), b(9, 'ember'),
      b(8, 'prism'), b(10, 'kiln'), up(4), up(3),
      up(0), up(1), up(8), up(9),
      up(10), b(2, 'ember'), up(0), up(1),
      up(4), up(3), up(8), up(9), up(10), up(2),
    ],
    runePriority: ['focusLens', 'overcharge', 'wideLens', 'greed', 'volatile', 'powderKeg', 'emberChains', 'slowBurn', 'sturdy', 'fortune'],
  },
  {
    level: 7,
    name: 'solid',
    desc: 'ember-heavy full map, thin halos, prisms unupgraded till late',
    steps: [
      b(5, 'grove'), b(7, 'ember'), b(6, 'ember'), up(7),
      b(0, 'kiln'), b(4, 'halo'), up(6), b(1, 'prism'),
      b(9, 'ember'), b(3, 'ember'), b(8, 'prism'), b(2, 'ember'),
      up(0), up(6), up(7), b(10, 'kiln'),
      up(1), up(9), up(3), up(4),
      up(2), up(8), up(10), up(0),
    ],
    runePriority: ['greed', 'overcharge', 'focusLens', 'sturdy', 'fortune'],
  },
  {
    level: 7,
    name: 'middling',
    desc: 'novice pattern: all 11 builds first, upgrades only after',
    steps: [
      b(0, 'ember'), b(1, 'halo'), b(2, 'prism'), b(3, 'kiln'),
      b(4, 'grove'), b(5, 'ember'), b(6, 'halo'), b(7, 'ember'),
      b(8, 'prism'), b(9, 'ember'), b(10, 'kiln'),
      up(0), up(1), up(2), up(3), up(4), up(5), up(6), up(7), up(8), up(9), up(10),
      up(0), up(1), up(2), up(3), up(4), up(5),
    ],
    runePriority: ['greed', 'overcharge', 'focusLens', 'sturdy', 'fortune'],
  },
  {
    level: 7,
    name: 'threestar',
    desc: '0-leak probe: pocket kiln 6 + grove pair (5+7), halos stack the B/D legs, late full fill',
    steps: [
      b(7, 'ember'), b(5, 'grove'), b(6, 'kiln'), up(7),
      b(3, 'halo'), b(4, 'halo'), up(6), b(0, 'kiln'),
      b(1, 'prism'), up(7), up(6), b(9, 'ember'),
      b(8, 'prism'), b(10, 'kiln'), up(4), up(3),
      up(0), up(1), up(8), up(9),
      up(10), b(2, 'ember'), up(0), up(1),
      up(4), up(3), up(8), up(9), up(10), up(2),
    ],
    runePriority: ['coldHeart', 'overcharge', 'wideLens', 'focusLens', 'slowBurn', 'volatile', 'powderKeg', 'emberChains', 'greed', 'swift', 'deepRoots', 'oldGrowth', 'farsight', 'sturdy', 'fortune'],
  },
  {
    level: 7,
    name: 'weak',
    desc: 'two towers for a 3020px walk',
    steps: [b(2, 'ember'), b(9, 'ember'), b(1, 'ember'), up(2)],
    runePriority: ['sturdy', 'fortune'],
  },

  // ================= Level 8 — The Silent Grove (west hollow, 2026-11-11 rework) =================
  // Tiles: 0(300,100) 1(480,320 CORNER) 2(300,320) 3(60,560) 4(300,560 grove-pair 5)
  //        5(420,560) 6(660,560) 7(300,780 MID) 8(480,780) 9(660,820) 10(300,960)
  //        11(100,860 WEST GATE). Lantern (140,1000). Path: entry → 4 staggered
  //        passes (y200 jog / y440 full / y700 / y900) → hollow drop.
  {
    level: 8,
    name: 'meta',
    desc: 'distributed DPS + hollow watch: lane ember pair lv3, corner prism, west gate',
    steps: [
      b(5, 'ember'), up(5), b(7, 'ember'), up(7),
      b(8, 'kiln'), b(1, 'prism'), up(5), up(7),
      b(4, 'grove'), b(11, 'ember'), up(8), b(3, 'halo'),
      up(11), b(0, 'ember'), b(2, 'ember'), up(1),
      b(10, 'ember'), b(6, 'ember'), up(0), up(2),
      b(9, 'ember'), up(10), up(6), up(9),
      b(12, 'ember'), up(3), up(4), up(11), up(0),
      up(2), up(1), up(8), up(12),
    ],
    runePriority: ['volatile', 'powderKeg', 'overcharge', 'greed', 'focusLens', 'emberChains', 'slowBurn', 'sturdy', 'fortune'],
  },
  {
    level: 8,
    name: 'solid',
    desc: 'ember-heavy, one kiln, no grove',
    steps: [
      b(5, 'ember'), b(7, 'ember'), up(5), b(8, 'kiln'),
      b(1, 'ember'), up(7), b(2, 'ember'), b(11, 'ember'),
      up(1), b(0, 'ember'), b(10, 'ember'), up(8),
      b(3, 'ember'), b(9, 'ember'), up(5), up(7),
      b(6, 'ember'), up(11), up(1), up(8),
      up(0), up(2), up(10), up(3),
      up(9), up(6),
    ],
    runePriority: ['greed', 'overcharge', 'volatile', 'sturdy', 'fortune'],
  },
  {
    level: 8,
    name: 'middling',
    desc: 'novice pattern: 12 of 13 builds (misses the hollow corner), upgrades only after',
    steps: [
      b(0, 'ember'), b(1, 'halo'), b(2, 'prism'), b(3, 'kiln'),
      b(4, 'grove'), b(5, 'ember'), b(6, 'halo'), b(7, 'prism'),
      b(8, 'ember'), b(9, 'kiln'), b(10, 'ember'), b(11, 'halo'),
      up(0), up(1), up(2), up(3), up(4), up(5), up(6), up(7), up(8), up(9), up(10), up(11),
      up(0), up(1), up(2), up(3), up(4), up(5),
    ],
    runePriority: ['greed', 'overcharge', 'volatile', 'sturdy', 'fortune'],
  },
  {
    level: 8,
    name: 'threestar',
    desc: '0-leak probe: full depth — all 13 tiles to lv3 (2-ups cap), lanes first, armor mid',
    steps: [
      b(5, 'ember'), up(5), b(7, 'ember'), up(7),
      b(0, 'ember'), up(0), b(12, 'ember'), up(12),
      b(11, 'ember'), up(11), b(2, 'ember'), up(2),
      b(1, 'prism'), up(1), b(8, 'kiln'), up(8),
      up(5), up(7), b(4, 'grove'), up(4),
      b(3, 'halo'), up(3), up(0), up(12),
      up(11), up(2), b(10, 'prism'), up(10),
      b(6, 'ember'), up(6), b(9, 'kiln'), up(9),
    ],
    runePriority: ['farsight', 'wideLens', 'focusLens', 'coldHeart', 'overcharge', 'volatile', 'powderKeg', 'slowBurn', 'emberChains', 'greed', 'swift', 'deepRoots', 'oldGrowth', 'sturdy', 'fortune'],
  },
  {
    level: 8,
    name: 'weak',
    desc: 'mid-map pocket only, wrong kinds',
    steps: [b(2, 'ember'), b(5, 'halo'), b(7, 'ember'), up(2), b(8, 'ember')],
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
      b(7, 'prism'), up(11), b(10, 'ember'),
      up(5), up(2), up(0), b(1, 'ember'), up(8),
      up(3), up(9), up(11), up(10), up(7), up(4),
    ],
    runePriority: ['overcharge', 'greed', 'volatile', 'powderKeg', 'focusLens', 'oldGrowth', 'deepRoots', 'emberChains', 'slowBurn', 'sturdy', 'swift', 'fortune'],
  },
  {
    level: 9,
    name: 'solid',
    desc: 'full map, mediocre mix, mid-speed upgrades',
    steps: [
      b(5, 'ember'), b(2, 'ember'), up(5), b(8, 'halo'), b(0, 'kiln'),
      b(11, 'ember'), b(4, 'prism'), up(2), b(9, 'ember'), b(3, 'halo'),
      b(7, 'ember'), b(10, 'prism'), b(1, 'ember'), b(6, 'ember'),
      up(5), up(8), up(0), up(11), up(9),
      up(4), up(7), up(3), up(2), up(5),
    ],
    runePriority: ['greed', 'overcharge', 'volatile', 'focusLens', 'sturdy', 'swift', 'farsight', 'fortune'],
  },
  {
    level: 9,
    name: 'middling',
    desc: 'novice pattern: all 12 builds first, upgrades only after',
    steps: [
      b(0, 'ember'), b(1, 'halo'), b(2, 'prism'), b(3, 'kiln'),
      b(4, 'grove'), b(5, 'ember'), b(6, 'halo'), b(7, 'ember'),
      b(8, 'prism'), b(9, 'ember'), b(10, 'kiln'), b(11, 'ember'),
      up(0), up(1), up(2), up(3), up(4), up(5), up(6), up(7), up(8), up(9), up(10), up(11),
      up(0), up(1), up(2), up(3), up(4), up(5), up(6),
    ],
    runePriority: ['greed', 'overcharge', 'volatile', 'focusLens', 'sturdy', 'swift', 'farsight', 'fortune'],
  },
  {
    level: 9,
    name: 'threestar',
    desc: '0-leak probe: embers on the 10/6 fly lanes before wave 4, then the grove/kiln core',
    steps: [
      b(10, 'ember'), b(6, 'ember'), b(2, 'prism'), up(10),
      b(4, 'grove'), b(8, 'kiln'), up(6), b(5, 'ember'),
      b(9, 'ember'), up(2), b(11, 'prism'), b(0, 'ember'),
      up(8), b(7, 'prism'),
      up(10), up(6), up(2), up(8),
      up(4), up(4), up(5), up(5), up(9), up(9), up(11), up(11), up(0), up(0), up(7), up(7),
    ],
    runePriority: ['coldHeart', 'overcharge', 'focusLens', 'volatile', 'powderKeg', 'slowBurn', 'emberChains', 'greed', 'deepRoots', 'oldGrowth', 'swift', 'farsight', 'wideLens', 'sturdy', 'fortune'],
  },
  {
    level: 9,
    name: 'weak',
    desc: 'half map, no plan',
    steps: [b(5, 'ember'), b(2, 'halo'), b(8, 'ember'), up(5), b(0, 'ember'), up(2)],
    runePriority: ['sturdy', 'fortune'],
  },

  // ================= Level 10 — The Heartwood (the finale, Root & Sprout) =================
  {
    level: 10,
    name: 'meta',
    desc: 'flyer wall on 6/10, spire nest, kilns fed by the rooted sprouts',
    steps: [
      b(6, 'ember'), b(10, 'ember'), b(3, 'prism'), up(6),
      b(11, 'grove'), b(9, 'kiln'), up(10), b(5, 'prism'),
      b(8, 'kiln'), b(7, 'ember'), up(3), b(0, 'prism'),
      up(11), up(9), b(1, 'halo'), b(4, 'ember'),
      up(6), up(10), up(5), up(3), up(8), up(9), up(7), up(11),
      up(0), up(1), up(4), up(5), up(8),
    ],
    runePriority: ['overcharge', 'greed', 'volatile', 'powderKeg', 'oldGrowth', 'deepRoots', 'focusLens', 'emberChains', 'slowBurn', 'sturdy', 'fortune'],
  },
  {
    level: 10,
    name: 'solid',
    desc: 'ring defense, ignores the fly lanes, no spire nest',
    steps: [
      b(0, 'ember'), b(1, 'halo'), b(7, 'ember'), up(0),
      b(8, 'halo'), b(4, 'ember'), b(2, 'prism'), up(7),
      b(9, 'ember'), b(5, 'kiln'), up(1), b(10, 'prism'),
      b(3, 'ember'), up(8), b(6, 'ember'),
      up(5), up(9), up(3), up(2), up(10),
    ],
    runePriority: ['greed', 'overcharge', 'volatile', 'focusLens', 'sturdy', 'fortune'],
  },
  {
    level: 10,
    name: 'middling',
    desc: 'novice pattern: all 12 builds first, upgrades only after',
    steps: [
      b(0, 'ember'), b(1, 'halo'), b(2, 'prism'), b(3, 'kiln'),
      b(4, 'grove'), b(5, 'ember'), b(6, 'halo'), b(7, 'ember'),
      b(8, 'prism'), b(9, 'ember'), b(10, 'kiln'), b(11, 'ember'),
      up(0), up(1), up(2), up(3), up(4), up(5), up(6), up(7), up(8), up(9), up(10), up(11),
      up(0), up(1), up(2), up(3), up(4), up(5),
    ],
    runePriority: ['greed', 'overcharge', 'volatile', 'focusLens', 'sturdy', 'fortune'],
  },
  {
    level: 10,
    name: 'threestar',
    desc: '0-leak probe: double wall on the 6/10 fly lanes, nest + kilns for the rooted sprouts',
    steps: [
      b(6, 'ember'), b(10, 'ember'), up(6), up(10),
      b(3, 'prism'), b(5, 'prism'), b(11, 'grove'),
      b(9, 'kiln'), b(8, 'kiln'), b(7, 'ember'),
      b(0, 'prism'), b(1, 'halo'), b(4, 'ember'), b(2, 'ember'),
      up(6), up(10), up(3), up(5),
      up(11), up(11), up(9), up(9), up(8), up(8), up(7), up(7),
      up(0), up(0), up(1), up(1), up(4), up(4), up(2), up(2),
    ],
    runePriority: ['coldHeart', 'overcharge', 'focusLens', 'volatile', 'powderKeg', 'slowBurn', 'emberChains', 'greed', 'deepRoots', 'oldGrowth', 'swift', 'farsight', 'wideLens', 'sturdy', 'fortune'],
  },
  {
    level: 10,
    name: 'weak',
    desc: 'no grove, no kilns — the Heartwood walks',
    steps: [b(7, 'ember'), b(1, 'halo'), b(2, 'prism'), up(7), b(0, 'ember'), up(2)],
    runePriority: ['sturdy', 'fortune'],
  },
];
