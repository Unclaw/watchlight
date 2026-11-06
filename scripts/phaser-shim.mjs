// Minimal Phaser shim for the headless balance simulator.
// `src/config.ts` imports Phaser for exactly one call (Math.Clamp inside
// makePath) — esbuild aliases `phaser` to this file when bundling the sim,
// so the simulator can import the REAL config (single source of truth)
// without a DOM. Keep the surface tiny; extend only if config grows.
export default {
  Math: {
    Clamp: (v, a, b) => Math.min(b, Math.max(a, v)),
    Linear: (a, b, t) => a + (b - a) * t,
    Between: (x1, y1, x2, y2) => Math.hypot(x2 - x1, y2 - y1),
  },
};
