import Phaser from 'phaser';

// Watchlight visual language — "flat vector glow" on a near-black field.
// Palette mirrored from the approved concept (concept.html :root tokens).
export const C = {
  bg: 0x0b1020,
  bg2: 0x101830,
  card: 0x16203a,
  card2: 0x1b2745,
  line: 0x2a3a63,
  amber: 0xffc24b,
  amber2: 0xff9d2e,
  cyan: 0x4fd8eb,
  violet: 0x9b8cff,
  green: 0x47e0a0,
  red: 0xff6b7a,
  white: 0xeef2ff,
  muted: 0x93a1c4,
} as const;

export const CSS = {
  amber: '#ffc24b',
  cyan: '#4fd8eb',
  violet: '#9b8cff',
  green: '#47e0a0',
  red: '#ff6b7a',
  white: '#eef2ff',
  muted: '#93a1c4',
  line: '#2a3a63',
  bg: '#0b1020',
} as const;

export const FONT = '"Avenir Next", "SF Pro Text", "Segoe UI", system-ui, sans-serif';

// Tower accent colours (warm/utility = defenders)
export const TOWER_COLOR: Record<string, number> = {
  ember: C.amber,
  prism: C.cyan,
  halo: C.violet,
  kiln: 0xff8b4b,
  grove: C.green,
};

// Enemy family colours (Murk = red/magenta family; shape carries identity)
export const ENEMY_COLOR: Record<string, number> = {
  runner: 0xff5f7a,
  swarm: 0xff8ea0,
  shielded:0xe05fff,
  flyer: 0xc86bff,
  healer: 0xff5fd0,
  boss: 0xff3b5c,
  miniboss: 0xff4f6e,
  heartwood: 0xff5c3d,
};

export function alpha(color: number, a: number): number {
  const t = Math.round(Phaser.Math.Clamp(a, 0, 1) * 255);
  return (t << 24) | (color & 0xffffff);
}
