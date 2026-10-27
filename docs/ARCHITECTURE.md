# Architecture — how the code is organized

Companion to `TECH_STACK.md` (why the pieces) and `DEV_NOTES.md` (invariants
and traps). This file explains the structure and the flow of control/data.

---

## Module map

```
src/
  main.ts            entry: Phaser.Game config, audio unlock, SW, window.__game
  theme.ts           the palette — ONE source of colour truth (CSS + int forms)
  config.ts          ALL game data: map, path math, towers, enemies, waves,
                     runes, economy. Pure data + pure functions, no Phaser
                     objects (except `posAt` borrowing Phaser.Math.Clamp).
  rng.ts             mulberry32 seeded RNG + daily-seed helper
  runes.ts           rune BEHAVIOUR (one modifier fn each) + runes-ids.ts (typed ids);
                     rune CONTENT (names/descriptions/pool) stays in config.ts
  audio.ts           procedural WebAudio singleton (voice pool, throttles)
  save.ts            localStorage load/patch/write, versioned schema
  debug.ts           ?query debug/CI flags parsed once
  scenes/
    BootScene.ts     generates every texture procedurally → Menu
    MenuScene.ts     title, mode select, how-to
    GameScene.ts     run orchestrator: game loop, phases, economy, combat
  systems/
    Hud.ts           dumb view: top bar, boss bars, start/speed, wave strip
    Fx.ts            visual effects pool: bursts, beams, shockwaves, absorb
  entities/
    Enemy.ts         one Murk creature: movement, slow/burn, damage, prediction
    Tower.ts         one defender: effective stats (via runes.ts), firing, aura ring
  ui/
    Button.ts        PillButton — shared touch-friendly pill
    BuildSheet.ts    bottom sheet: build cards / upgrade+sell panel
    RuneOverlay.ts   roguelite pick-1-of-3
    RuneIcon.ts      shared rune icon renderer (pick cards + peek button)
    RuneButton.ts    press-and-hold rune peek (collapsed badge + detail card)
    Overlays.ts      pause / victory / defeat panels
scripts/             dev/test tooling (icons, pixel checker, CDP e2e)
public/              PWA shell (manifest, sw.js, icons)
```

Intended dependency direction: `config/runes → entities/systems →
GameScene → ui`. GameScene owns all authoritative run state; Hud and Fx are
stateless views it feeds. Honest caveat (external review H2): entities call
*back up* into the concrete GameScene (`killEnemy`, `flashWhite`,
`spawnBolt`…) and UI overlays use structural casts — the layering is a
convention, not compiler-checked. The planned `ScenePort` interface closes
this when the run-model extraction happens (see DEV_NOTES §7).

## Scene flow

```
Boot ──(textures generated)──► Menu ──play/daily/endless──► Game
                                     ▲                        │
                                     └──── scene.start ───────┘
                          Game restart = scene.restart() (same instance!)
```

- Boot exists purely to mint textures once; it holds no state.
- Menu owns mode selection; the daily seed is derived from the date there.
- Game owns the entire run. **`scene.restart()` reuses the class instance**,
  which is why `create()` begins with a full reset block — the rule and the
  checklist live in `DEV_NOTES.md §1`.

## The game loop (the most important 40 lines)

`GameScene.update(time, delta)` runs every frame and is the only place that
mutates run state:

1. **Early-out** when paused / over / won / rune-pending.
2. **Delta discipline:** `dt = min(delta, 100) * speedMult`. Clamping kills
   tab-switch spikes; `speedMult` is the ×2 toggle. This scaled dt feeds
   *everything* gameplay — spawn queue, movement, cooldowns, auras, burns.
3. **Spawns:** pop `spawnQueue` entries whose time ≤ `waveTime`.
4. **Enemies:** `e.update(dt)` — position from path progress, burn ticks,
   healer aura, tint state. Returns `'leak'` → `leak(e)` (lantern damage +
   absorb animation).
5. **Towers:** acquire target (min `remaining` in range) and fire per kind.
6. **Projectiles:** bolts home (re-aiming at the live target each frame),
   shells fly a fixed parabola to a *predicted* point (`Enemy.posAhead`).
7. **Housekeeping:** filter dead enemies, redraw HP-bar Graphics, check
   wave-complete, throttle-refresh HUD (150 ms).

Phaser's Clock and TweenManager are used **only for visuals and reveal
delays** — see DEV_NOTES §1 "two clocks" for the reasoning.

## Data-driven core (`config.ts`)

Everything a designer would tune is in one file as plain data:
`LEVELS` (one `LevelDef` each: map waypoints/tiles/lantern/flyer spawns,
handcrafted wave table, start gold/HP, tower roster, enemy roster, runes
flag, hp multiplier), `TOWERS` (3 tiers each, kind-specific extras like
`splash`/`slow`), `ENEMIES` (hp/speed/bounty/leak/armor/radius), the
`RUNES` table, and the economy constants. Runtime code never hardcodes
these numbers, so adding level 4 is a data-only change.

Level resolution: mode `level` → `LEVELS[levelId-1]`; `daily`/`endless`
always run the full-bestiary level 3 map. Rosters gate both the build sheet
and the endless generator; `buildTower` refuses off-roster kinds. Endless
composition beyond a level's table is filtered to its roster (bosses only
where the roster has them).

Path math is per-level: `makePath(waypoints)` builds a cumulative-segment
index (`path.posAt(d)`, `path.len`) owned by GameScene — used by ground
movement, chevron rendering and shell leading.

## Wave pipeline & determinism

```
endWave(): gold bonus → waveIndex++ → nextWaveGroups = waveGroups(level, waveIndex, rng)
           → victory check → [rune overlay →] setStrip('next')
startWave(): consumes nextWaveGroups (never regenerates) → currentWaveGroups
           → setStrip('remaining') → spawnQueue
```

- The composition is generated **once per wave** so the preview card always
  shows exactly what spawns, and the seeded RNG is consumed exactly once per
  endless wave (daily runs stay reproducible).
- Rune picks happen between waves 5/10/15/20…; the strip deliberately
  waits for the pick (product rule). Owned runes surface through the
  press-and-hold RuneButton (newest rune + count badge collapsed; full
  card with descriptions while held), and the lantern glow radius is
  rune-driven: 0.7 with no runes → 1.0 from three runes on (linear).
- The bottom **wave strip** is one persistent component with two modes:
  `next` (prep position y≈1105, upcoming composition) and `remaining`
  (slides to y≈1188 replacing the hidden start button; chips show
  alive+queued counts, dimming to 0.35 when a kind is cleared).

## Runes as modifiers

A run holds `runes: Set<string>`. Effects are implemented *at the point of
use* (e.g. `Tower.rate` checks `overcharge`), so no rune needs a handler or
event system — and `applyRune` only handles the three stat-mutating ones
(`sturdy`, `fortune`, `farsight` refresh). Weakness (noted in the refactor
wishlist): stringly-typed; a typed effect table is the natural evolution.

## Entities

- **Enemy:** ground units interpolate the path polyline; flyers lerp
  spawn→lantern with a sine bob. `remaining` (px to lantern) is the shared
  targeting key. Slow/burn are timestamped (`slowUntil`/`burnUntil`) against
  `gameTime`, so effects survive pause exactly. Exit paths: `killEnemy`
  (bounty, burst) or `leak` (lantern damage, absorb) — nothing else.
- **Tower:** exposes *effective* stats as getters (`dmg/rate/range/splash/
  slow`) applying runes — every consumer sees the same modified values.
  Firing is a manual cooldown accumulator per kind: ember → homing bolt,
  prism → instant line (capsule hit test) with a beam sprite, halo → aura
  tick (slow + damage + shockwave ring, persistent influence ring), kiln →
  arcing shell with splash. Halo is the only tower without a cooldown —
  an aura tick counter instead.

## UI layer

All UI is Phaser containers for the reasons in `TECH_STACK.md`. Conventions:
- Interactive hit areas are `Zone`s sized ≥ ~56 px; press feedback is a
  scale tween + `tap` cue (audio unlocks on first gesture anywhere).
- Modal things (build sheet, rune overlay, pause/end) dim the world with an
  interactive rectangle — that's how "tap outside to close" works.
- The HUD refreshes on a 150 ms game-time throttle, and that same pass
  drives the upgrade-affordable chevrons.

## Debug & test hooks (deliberate, documented)

Query params, no build-time flags: `?scene=game`, `&auto=1` (auto-start
wave), `&demo=1` (auto-build + chain waves), `&restart=1` (one in-game
restart), `&assert=1` (console assertions). They are the CI surface for
`scripts/cdp-smoke.mjs` and cost nothing in production. See `TESTING.md`.

## Save schema

`SaveData` (bestWave, wins, runs, totalKills, mute, wonOnce, daily,
levelStars: Record<levelId, 0-3>) lives in localStorage under
`watchlight.save.v1`; `patchSave` does read-merge-write. GameScene mutates
it only at run boundaries (defeat / victory). Unlocks: level N unlocks when
level N−1 has ≥1 star.
