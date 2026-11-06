// Shared geometry helpers — Phaser-free, used by BOTH the game (GameScene,
// entities) and the headless balance simulator (scripts/sim-main.ts).
// This is the H1-lite shared core: what lives here can never drift (§7).
export const dist2 = (ax: number, ay: number, bx: number, by: number): number =>
  (ax - bx) * (ax - bx) + (ay - by) * (ay - by);

export const dist = (ax: number, ay: number, bx: number, by: number): number =>
  Math.hypot(ax - bx, ay - by);

/** Distance from point P to segment AB (beam hit tests). */
export function distToSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return dist(px, py, ax, ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / l2;
  t = Math.min(1, Math.max(0, t));
  return dist(px, py, ax + t * dx, ay + t * dy);
}
