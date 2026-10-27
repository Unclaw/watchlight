# Dev notes — gotchas & invariants learned while testing

Working notes captured during prototype development and debugging (sessions
2026-10-16). Read before refactoring: these are behaviours that bit us at
least once, most of them invisible in the code until something breaks.

---

## 1. Phaser lifecycle rules (the big one)

### `scene.restart()` destroys game objects — but NOT your fields
- On restart/stop, the DisplayList destroys every game object added via
  `scene.add.*` (sprites, zones, graphics, containers, texts). Tweens and
  scene Clock events are cleaned too.
- **Class field initializers do NOT re-run** — the Scene instance is reused.
  Any field holding game objects or run state that isn't re-assigned in
  `create()` becomes a stale pointer into destroyed objects.
- This caused the "Restart run is stuck on previous state" bug: `this.tiles`
  still held 14 destroyed tiles in front of the 14 fresh ones, and every tile
  zone handler indexed `this.tiles[i]` → ghost tiles/ghost towers.
- **Rule:** the top of `GameScene.create()` is a *full reset block*. If you
  add a field that holds a game object (or run state), reset it there. Fields
  currently in the block: enemies, towers, bolts, shells, **tiles**,
  spawnQueue, waveTime, nextWaveGroups, wavePreview, selectedTile, lastHud,
  banner, hpBars, plus all run economy fields.

### Sprite ownership table — every object must be destroyed exactly once
| Object | Created by | Destroyed by |
|---|---|---|
| Enemy sprite | Enemy ctor | `killEnemy()` → `e.destroy()` **or** `leak()` absorb tween |
| Tower sprite/pips/upMarker/auraRing | Tower ctor | `Tower.destroy()` (sell or scene shutdown) |
| Bolt/shell sprites | spawnBolt/fireShell | arrival handlers in `update()` |
| Beam/spark/ring/shockwave visuals | fire sites | their own fade tween `onComplete` |
| Wave preview container | `showWavePreview` | `hideWavePreview` tween / create reset |
| PillButton container | overlays | panel destroy / scene shutdown |
- `GameObject.destroy()` is re-entrant-safe (Phaser nulls `scene` and guards),
  so double-destroy is tolerated but should still be avoided on purpose.
- If a destroy is deferred through a tween (leak absorb, shockwaves), scene
  shutdown mid-tween is safe: the tween dies with the scene and the display
  list destroys the sprite anyway.

### Timers: two clocks on purpose
- **Gameplay timing = manual accumulators** (`gameTime`, cooldowns, spawn
  queue, aura ticks, burn/slow expiry). Pause and the ×2 speed toggle must be
  exact; Phaser Clock would need parallel timeScale plumbing.
- **Phaser Clock (`time.delayedCall`) and Tweens = visuals/UX only**: the
  700ms wave-preview reveal, demo auto-start, boss banner. Consequence: these
  do NOT respect the in-game pause/speed — acceptable for reveal delays,
  never use them for gameplay.
- Naming: `Scene.time` is already Phaser's Clock — the game clock field is
  `gameTime`. Don't "fix" this by renaming onto `time`.

### Monkey-patch lesson (testing)
Phaser Clock/plugin event listeners capture method *references* at
registration. Assigning `obj.method = wrapper` later does **not** intercept
the already-registered listener. When probing in-page, patch before the event
fires or wrap at call sites you own.

---

## 2. Game-state invariants & coupling

### `waveIndex` ⇄ `nextWaveGroups` must move together
- `startWave()` consumes the **stored** `nextWaveGroups` (computed once in
  `endWave`, or for wave 1 in `create`). This is what keeps the next-wave
  preview honest and the seeded endless RNG single-consumption.
- Invariant: they only advance through `endWave()`. Mutating `waveIndex`
  externally (test harness!) desyncs: `startWave()` will replay the stored
  composition with the new wave's scaling. In the smoke/probe scripts, always
  set `s.nextWaveGroups = null` when forcing a wave index.
- Related: RNG is **forked per concern** from one master seed (composition /
  combat variance / rune shuffles — `GameScene.init()`), so adding or
  removing a consumer in one stream cannot shift another. The daily seed is
  UTC-derived with the full date range. Before you add a *new* randomness
  consumer, decide which stream it belongs in (or fork a new one) rather
  than borrowing an existing stream.

### `remaining` is the universal targeting key
Ground enemies: `PATH_LEN - dist`. Flyers: `(1 - flyT) * flyLen`. Towers
target `min(remaining)` within range. Any new enemy type must maintain
`remaining` or tower priority silently degrades.

### Sell refunds are floored and phase-gated
`Tower.sellValue = floor(invested × rate)` where rate comes from
`config.ts ECONOMY` (100% in any non-wave phase, 60% during a wave).
`invested` tracks gold actually paid (incl. rune discounts), so at any
rate ≤ 1 a sell+rebuild cycle can never create gold — the zero-sum prep
behaviour is locked by smoke checks. If you ever change refunds to
round-to-nearest or refund *current* build cost instead of invested,
re-check the spam tests first.

### Leak vs kill are the only two exits
`Enemy.update()` returns `'leak'` → `GameScene.leak()` (sets `alive=false`
itself, caller filters). Burn death calls `killEnemy(e, false)` from inside
the enemy. Anything else that "removes" an enemy is a bug by construction —
the wave-complete check is `spawnQueue empty && enemies.length === 0`.

---

## 3. Visuals: tint/tween rules

- **Per-frame `setTint` cancels `setTintFill`** (the white hit-flash). Enemy
  update applies slow-tint only while `gameTime >= flashUntil`; the flash is
  routed through `Enemy.flashWhite()` which owns that timestamp. If you add
  another per-frame tint (burn? shield?), follow the same "one winner per
  frame with timestamp guards" pattern.
- Additive (`BlendModes.ADD`) sprites are fill-rate expensive on mobile —
  keep them small and few (baked glows in textures beat layered glow sprites).
- All textures are generated in BootScene at 2× supersample and displayed at
  ×0.5; keep that pipeline (crisp on 3× screens, tiny GPU budget ~2.4MB).
- Overlapping UI is tap-through unless `setInteractive` is called. Panels that
  must block input use an interactive dim rectangle (BuildSheet pattern). The
  wave strip sits at the bottom and never covers build tiles — the old preview
  card did (deliberately tap-through), keep that principle if layout changes.

---

## 4. Testing harness (scripts/cdp-smoke.mjs & friends)

### Headless Chromium quirks in this container (all hit empirically)
1. **rAF is frozen until the first real input event** (tab counts as
   backgrounded). The smoke sends a "wake" click on a non-interactive path
   point after the scene-ready poll. Without it, Phaser's clock never ticks.
2. **Software WebGL (swiftshader) runs game time ≈ 0.4× wall time.** Never
   assert on fixed sleeps — poll state via `waitFor(expr)` instead.
3. **The screenshot can be written while the process never exits** → always
   run chromium under `timeout` and judge by the output file (this hung a
   whole session once).
4. **console.log flush races with fast virtual-time exit** — late logs can
   vanish even though the code ran. Read state via CDP
   `Runtime.evaluate` (deterministic) instead of console scraping.
5. dbus/systemd errors in stderr are noise, ignore.
6. **`timeout`-killed runs orphan the browser**: SIGTERM kills node before
   the `finally` can close chromium — the orphan keeps port 9333 + the
   profile dir, and the NEXT run silently connects to its stale mid-suite
   page (symptom: impossible state like gold 500 at wave 1). Kill by the
   profile arg (`pkill -9 -f "cdp-smoke-profil[e]"`) — a pattern like
   `chromium --headless` misses it because the URL arg splits the string.

### In-page API the smoke relies on (compile-time private ≠ runtime private)
`window.__game` is exposed from `main.ts` (read-only intent). The smoke
touches: `tiles`, `towers`, `enemies`, `spawnQueue`, `phase`, `gold`, `hp`,
`leaks`, `waveIndex`, `wavePreview`, `nextWaveGroups`, `sheet.isOpen()`,
`buildTower/upgradeTower/sellTower`, `Tower.upgradeMarkerVisible`,
`Tower.auraRing.radius`, `Enemy.dist/flyT`, `waveStripMode`,
`pendingRuneChoices`, `hud.bossBar.visible`, `sheet.affordableKinds()`,
`runeButton` (runeCount/expanded), `lanternGlow`,
`activeRuneOverlay.iconOrderValid()` (render-order contract). **Renaming any of these breaks
the smoke suite — update the script in the same commit.**
- The `state()` helper wraps as `return (${expr});` → single expression
  only. Multi-assignment needs the comma operator:
  `s.a = 1, s.b = 2, true` (a `;` chain silently executes only the first).

### Tile/card coordinates are hardcoded in the tests
Smoke runs on level 1 by default (`?level=N` jumps elsewhere — tile counts
and sheet grid positions are level-dependent). Level-1 smoke clicks:
`(440,200)` tile 0, `(40,440)` tile 2, `(280,440)` tile 3,
ember card `(204,1076)` (col 0), halo card `(516,1076)` (col 1 — level 1's
sheet has only ember+halo), start button `(360,1188)`
(**visible only during prep** — it hides when the wave strip takes the bottom),
dim-close tap `(360,560)`. Wave strip: centred (x 126–594), prep y=1105 → wave y=1188. Rune peek
button: round, centre (646,1097) — column of the speed toggle, free band
right of the prep strip; press-and-hold expands a detail card, release
collapses; collapsed shows the newest rune + '+N' badge.
The demo hook builds tile indices `2,4,8,1,9`. If `TILES`/`BuildSheet`/HUD layout changes, these must change.
Consider exporting layout constants for tests if it churns.

---

## 5. Refactor wishlist (post-refactor state, 2026-10-16)

Done in the targeted refactor:
- ✔ `GameScene` split: HUD + wave strip → `systems/Hud.ts`, all visual
  effects → `systems/Fx.ts`. GameScene is now the ~850-line run orchestrator
  (loop, phases, economy, combat plumbing). A `WaveDirector` split was
  considered and rejected: wave flow needs gold/hp/phase/strip and would
  devolve into a callback web — revisit only if a second map/level system
  arrives.
- ✔ Rune effects centralized: `runes.ts` (one modifier fn per rune, typed
  ids in `runes-ids.ts`); content table stays in `config.ts`.
- ✔ Debug params consolidated in `debug.ts`.

Still open (deliberately):
- `BuildSheet` card coordinates are magic numbers duplicated between
  `showBuild` (layout) and the smoke test (click targets).
- Save schema has no migration path beyond the `v1` key name.
- `enemy_` texture key prefix is also used as a scene-scan filter in the
  smoke (leak-residue check) — keep the prefix if textures are reorganized.

---

## 6. Ops cheat-sheet

```bash
npm run dev                      # dev server 0.0.0.0:3000 (HMR)
npm run build && npm run preview # prod build on :3000 (what you playtest)
node scripts/cdp-smoke.mjs       # 32-check e2e (server must be up)
node scripts/cdp-bot.mjs         # plays a full level headless (balance validation)
node scripts/cdp-shots.mjs       # PNG screenshots of every UI state → ui-audit*/
node scripts/check-shot.mjs f.png# screenshot pixel-coverage decoder
node scripts/gen-icons.mjs       # regenerate PWA icons (no deps)
node scripts/sim.mjs --coverage  # tile coverage report (all levels)
node scripts/sim.mjs --level 2 --waves  # balance sim: policies × seeds
```
- The preview server occasionally dies (e.g. after cleanup `pkill`s) —
  symptoms: smoke fails instantly with `page eval failed: Uncaught`, curl
  returns 000. Restart it before suspecting the code.
- Lighthouse: `lh http://127.0.0.1:3000 menu` → `reports/` (gitignored).

---

## 7. Deferred architecture findings (external review, 2026-10-22)

Fixed immediately (see commits that day): daily determinism (UTC seed,
forked RNG streams, single-consume on victory), `pendingRuneChoices` reset
gap, combat tuning constants moved to `config.ts` COMBAT (halo `rate` was
dead data), rune-id typing at the boundary, docs drift.

Deliberately deferred — act on the trigger, not before:

| Finding | Trigger to act |
|---|---|
| H1 god-object → extract Phaser-free run model (RunState/WaveDirector/CombatResolver) | Balance *automation* or unit tests becoming valuable, or levels 4+ bringing logic churn. Content work is config-only and doesn't need it. Defuses H3 structurally. **Balance automation now exists (scripts/sim.mjs, 2026-10-25) as a scripts/-side mirror of the GameScene loop — H1 extraction is justified the moment the mirror drifts twice or unit tests are wanted; the sim's fidelity contract is documented in its header.** |
| H2 entities welded to concrete GameScene → `ScenePort` interface | Fold into H1 (same seam). |
| M1 redundant state machine (`over` vs `phase==='over'`, `endlessUnlocked`) | Fold into H1, or next state-machine touch. |
| M2 full rune effect table (stat/statQuery/instant entries) | Before adding rune #12 / the next rune batch. |
| M4 export layout constants for the smoke harness | Next UI layout change. Unit seam comes with H1. |
| M7 derive `CSS` palette from `C` + sweep hardcoded literals | Lantern-skins work (theming) — that's when palette discipline pays. |
| L1 save schema migration (versioned transforms in one key) | First schema change after shipping publicly. |
| L3/L4 dead code (`Hud.destroy`, dead params, unused exports; `Tower.slow` fallback) | Next cleanup commit. |
| L8 SW version hand-managed | Build-time derivation near real releases; bump is on the deploy checklist until then. |
| L9 O(n²) scans / L10 mid-frame defeat | Note only — fine at current scale. |
