#!/usr/bin/env node
// Balance simulator runner — bundles scripts/sim-main.ts (+ the REAL
// src/config.ts) with esbuild, aliasing `phaser` to the tiny shim so the
// config module loads in Node. Then executes the CLI.
//
// Usage:
//   node scripts/sim.mjs --coverage                 # tile coverage report
//   node scripts/sim.mjs --level 2                  # all policies, 30 seeds
//   node scripts/sim.mjs --level 2 --policy meta --seeds 100 --waves
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';

const OUT = new URL('./.sim-bundle.mjs', import.meta.url).pathname;
await build({
  entryPoints: [new URL('./sim-main.ts', import.meta.url).pathname],
  bundle: true,
  format: 'esm',
  platform: 'node',
  alias: { phaser: new URL('./phaser-shim.mjs', import.meta.url).pathname },
  outfile: OUT,
  logLevel: 'silent',
});
const mod = await import(pathToFileURL(OUT).href);
mod.main();
