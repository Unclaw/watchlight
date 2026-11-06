# Watchlight — a lightweight tower defence for the web

Portrait, one-thumb, minimalist tower defence: defend the **Last Lantern** from geometric
Murk-creatures. Short, replayable runs; roguelite rune picks. Plays anywhere — phone,
tablet, desktop — and installs from the browser as an offline PWA. **Non-commercial** —
an exploration of possibilities, free to play, nothing sold.

**Status:** beta v0.8.1 — live on GitHub Pages · **Stack:** TypeScript (strict) · Vite ·
Phaser 3 · PWA (a native wrap via Capacitor stays optional).
**Languages:** English + Русский — auto-detected from the device, switchable on the
menu (bottom row), overridable per URL with `?lang=ru|en`. All strings live in `src/i18n.ts`.

## Run it

```bash
npm install
npm run dev        # → http://localhost:3000 (binds 0.0.0.0)
npm run build && npm run preview   # production build on :3000
```

On your phone: open the dev/preview URL → **Add to Home Screen** (iOS Safari) /
**Install app** (Android & desktop browsers) → plays fullscreen & offline (service
worker caches the shell; home-screen PWA storage is ITP-exempt on iOS).

## How to play

- Tap a dim square beside the path → build a tower (5 archetypes, 3 tiers each)
  - **Ember Spire** — fast single-target sparks
  - **Prism Beam** — piercing line damage
  - **Halo Bloom** — slowing aura + steady burn
  - **Kiln** — heavy splash mortar (shielded Murk shrugs off fast hits)
  - **Wisp Grove** (from level 6) — support tower: empowers adjacent towers'
    damage & rate; no attack of its own
- Tap a tower → upgrade / sell. A green bobbing chevron marks towers whose next tier you can afford
- Selling refunds **100% before the wave starts** (free rearrangement during
  prep) and 60% while a wave runs — both rates tunable in `config.ts` `ECONOMY`
- **Start Wave** button (bottom); ×1/×2 speed toggle beside it; pause top-right
- A **wave strip** at the bottom shows the upcoming enemy mix during prep, then
  becomes a live *remaining-enemies* tracker once the wave starts (on rune waves
  it waits for the pick). Cards/upgrade buttons light up live as gold arrives
- Every 5th wave → claim 1 of 3 **runes** (lasts the whole run) — a peek
  button above the speed toggle shows your newest rune (+N badge);
  **press and hold** it for the full list with descriptions. The lantern's
  glow grows from 70% to full radius as you collect your first three
- 10–24 waves per level (boss finale on the last wave — level 10 ends with
  the **Heartwood Murk**, which summons runner packs as it crawls).
  **Endless Night unlocks after clearing level 10**; 0 leaks = 3 stars
- **Daily Run**: same seed for everyone that day, on the full-bestiary map
- The menu is a **biome hub**: the Woodlands card expands in place into the
  ten-level grid; Deepmarsh and Ashen Wastes are teased as the next biomes

## Architecture

```
src/
  main.ts            entry: Phaser config (FIT scale, 60fps cap), audio unlock, SW
  config.ts          ALL game data: 10 levels (maps/waves/rosters/themes),
                     5 towers, 8 enemy families, 16 runes, endless generator
  theme.ts           palette (single visual language everywhere)
  i18n.ts            every player string: EN source of truth + full RU localization
  rng.ts             seeded mulberry32 (deterministic daily runs)
  audio.ts           procedural WebAudio: 14-voice pool, per-cue throttling, ambient pad
  runes.ts           rune effect table: one modifier fn per rune (stat/flag/queries)
  save.ts            localStorage persistence
  wakeLock.ts        Screen Wake Lock while the game is visible
  sim/               Phaser-free combat core — shared by the game AND the headless
                     balance simulator, so the two can never drift: enemy state/
                     movement, tower stats (runes + grove buffs), targeting and
                     beam/splash/chain resolution, projectiles, wave/economy flow
  scenes/
    BootScene.ts     generates every texture procedurally (2× supersampled, tiny GPU cost)
    MenuScene.ts     biome hub: Woodlands grid + coming-soon teasers, daily/endless, how-to
    GameScene.ts     run loop: waves, economy, combat, phases, runes, end states
  systems/           Hud.ts (HUD + wave strip), Fx.ts (all combat visuals)
  entities/          Enemy.ts, Tower.ts (manual clocks — pause & 2× speed stay exact)
  ui/                Button, BuildSheet (one-thumb bottom sheet; exported geometry
                     shared with the e2e tests), RuneButton/RuneOverlay, Overlays
scripts/
  gen-icons.mjs      dependency-free PNG icon generator (same art language)
  cdp-smoke.mjs      33-check e2e via CDP (no deps): real clicks, asserts build/sell/waves
  cdp-bot.mjs        plays a full level headless (balance validation)
  sim.mjs            balance simulator: policies × seeds over the shared src/sim core
  cdp-shots.mjs      screenshots of every UI state; check-shot.mjs decodes coverage
public/
  manifest.webmanifest, sw.js (offline-first app shell)
```

Debug/CI hooks: `?scene=game` (skip menu), `&auto=1` (auto-start wave),
`&demo=1` (auto-builds one of each tower and chains waves — used for headless soaks).

## Mobile-web best practices honoured

| iOS quirk | Response |
|---|---|
| AudioContext locked until gesture | unlock inside first `pointerdown`; sound pool + throttling |
| Memory/texture kill zones | all textures generated at 2× supersample; total transfer ~356 KiB gz |
| Canvas resize leak | single canvas, CSS-scaled (`Scale.FIT`), debounced `scale.refresh()` |
| Viewport / safe areas | `100dvh`, `viewport-fit=cover`, `position:fixed` body, controls inset |
| Double-tap zoom / callouts | `touch-action: manipulation`, tap-highlight off, no user-select |
| Backgrounding | `visibilitychange` → auto-pause overlay |
| WebGL context loss | handled by Phaser; gameplay auto-pauses via visibility change |
| 7-day ITP storage eviction | PWA exempt; save export/import codes on the roadmap |

## Native builds (optional)

The web PWA is the product — native is an option, not the goal. The repo stays
Capacitor-ready (`capacitor.config.ts`, `base: './'`), so if a native App Store build
is ever wanted, on any Mac:

```bash
npm i -D @capacitor/cli @capacitor/core @capacitor/ios
npx cap add ios && npx cap sync && npx cap open ios
# then Archive → TestFlight in Xcode
```

## Shipping it

- **Hosting**: push to GitHub → repo Settings → Pages → Source: GitHub Actions
  (workflow included). Terminal alternative: `surge dist`.

## Project layout

- `src/` — game code (Phaser scenes, entities, UI, config-driven content)
- `scripts/` — headless test harness (CDP e2e), balance simulator, tooling
- `.github/workflows/` — GitHub Pages auto-deploy

## Status / roadmap

**Beta, live on GitHub Pages** — v0.8.1: the full **Woodlands arc** with the
Root & Sprout finale; balance is sim-validated (30-seed policy sweeps) plus
external playtesters.

Shipped so far:

- 10-level **Woodlands** arc (biome hub menu, per-level ambience themes,
  progressive tower/roster unlocks) — L1 *The Crossing* → L10 *The Heartwood*
- 5 towers × 3 tiers — incl. the Wisp Grove support tower (L6+)
- 8 enemy families — runners, swarm, shielded, flyers, healers, boss,
  miniboss, and the Heartwood Murk finale boss (**Root & Sprout**: roots at
  HP thresholds, sprouts runner packs, bark-hardened vs splash)
- 16 roguelite runes (level-roster filtered, ≥2 exclusive per tower),
  press-and-hold rune peek, lantern glow as rune meter
- Flyer-lane prep preview + first-time mechanic tips; Endless Night
  (unlocks after L10), UTC-seeded Daily Run (full-bestiary map),
  prep/wave sell-refund economy, screen wake lock
- EN + RU localization; PWA shell (offline, installable); 35-check CDP e2e
  suite + headless balance bot + policy simulator

Next, in order:

1. **Beta feedback pass** — playtest L4–L10 balance and the biome-menu feel
2. Finish RU on the Woodlands strings; language polish
3. Save export/import codes (device migration / ITP safety net)
4. **Deepmarsh** — the second biome (~10 more levels)
