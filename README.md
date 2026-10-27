# Watchlight — a lightweight tower defence for iOS

Portrait, one-thumb, minimalist tower defence: defend the **Last Lantern** from geometric
Murk-creatures. 5–8 minute runs, roguelite rune picks. **Non-commercial** — an exploration
of possibilities, free to play, nothing sold.

**Status:** alpha v0.3 · **Stack:** TypeScript (strict) · Vite · Phaser 3 · PWA first · Capacitor-ready.
**Languages:** English + Русский — auto-detected from the device, switchable on the
menu (bottom row), overridable per URL with `?lang=ru|en`. All strings live in `src/i18n.ts`.

## Run it

```bash
npm install
npm run dev        # → http://localhost:3000 (binds 0.0.0.0)
npm run build && npm run preview   # production build on :3000
```

On iPhone: open the dev/preview URL in Safari → Share → **Add to Home Screen** → plays
fullscreen & offline (service worker caches the shell; home-screen PWA storage is
ITP-exempt on iOS).

## How to play

- Tap a dim square beside the path → build a tower (4 archetypes, 3 tiers each)
  - **Ember Spire** — fast single-target sparks
  - **Prism Beam** — piercing line damage
  - **Halo Bloom** — slowing aura + steady burn
  - **Kiln** — heavy splash mortar (shielded Murk shrugs off fast hits)
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
- 10–20 waves per level (boss finale on the last wave), then Endless Night. No leaks = 3 stars.
- **Daily Run**: same seed for everyone that day.

## Architecture

```
src/
  main.ts            entry: Phaser config (FIT scale, 60fps cap), audio unlock, SW
  config.ts          ALL game data: 3 levels (maps/waves/rosters), towers,
                     enemies, runes, endless generator
  theme.ts           palette (single visual language everywhere)
  rng.ts             seeded mulberry32 (deterministic daily runs)
  audio.ts           procedural WebAudio: 14-voice pool, per-cue throttling, ambient pad
  save.ts            localStorage persistence
  scenes/
    BootScene.ts     generates every texture procedurally (2× supersampled, tiny GPU cost)
    MenuScene.ts     title / daily / endless / how-to
    GameScene.ts     run loop: waves, economy, combat, HUD, runes, end states
  entities/          Enemy.ts, Tower.ts (manual clocks — pause & 2× speed stay exact)
  ui/                Button, BuildSheet (one-thumb bottom sheet), RuneOverlay, Overlays
scripts/
  gen-icons.mjs      dependency-free PNG icon generator (same art language)
  check-shot.mjs     headless smoke: decodes screenshots, asserts colour coverage
  cdp-smoke.mjs      e2e via CDP (no deps): real clicks, asserts build/chevron/waves
public/
  manifest.webmanifest, sw.js (offline-first app shell)
```

Debug/CI hooks: `?scene=game` (skip menu), `&auto=1` (auto-start wave),
`&demo=1` (auto-builds one of each tower and chains waves — used for headless soaks).

## iOS best practices honoured (from the research)

| iOS quirk | Response |
|---|---|
| AudioContext locked until gesture | unlock inside first `pointerdown`; sound pool + throttling |
| Memory/texture kill zones | all textures generated at 2× supersample; total transfer 344 KiB gz |
| Canvas resize leak | single canvas, CSS-scaled (`Scale.FIT`), debounced `scale.refresh()` |
| Viewport / safe areas | `100dvh`, `viewport-fit=cover`, `position:fixed` body, controls inset |
| Double-tap zoom / callouts | `touch-action: manipulation`, tap-highlight off, no user-select |
| Backgrounding | `visibilitychange` → auto-pause overlay |
| WebGL context loss | handled by Phaser; gameplay auto-pauses via visibility change |
| 7-day ITP storage eviction | PWA exempt; save export/import planned (see research D8) |

## Native iOS build (the one step this container can't do)

The repo is Capacitor-ready (`capacitor.config.ts`, `base: './'`). On any Mac:

```bash
npm i -D @capacitor/cli @capacitor/core @capacitor/ios
npx cap add ios && npx cap sync && npx cap open ios
# then Archive → TestFlight in Xcode
```

## Shipping it

- **Hosting (incl. verification-free options)** → `docs/IPHONE_GUIDE.md`

## Documentation

- `docs/TECH_STACK.md` — every technology choice, the alternatives rejected,
  and the performance budgets vs measured numbers.
- `docs/ARCHITECTURE.md` — module map, scene flow, the game loop, wave
  pipeline & determinism, entity contracts, UI conventions.
- `docs/TESTING.md` — test layers, the CDP e2e harness design and patterns,
  known gaps.
- `docs/IPHONE_GUIDE.md` — how to build and ship to iPhone: PWA today
  (no Mac) and the Capacitor → TestFlight path for later.
- `DEV_NOTES.md` — hard-won invariants and testing gotchas (Phaser restart
  lifecycle, wave-state coupling, headless-Chromium quirks, the runtime API
  the smoke suite depends on). Read before refactoring.
- `docs/STACK.md` documents the agent environment the project was built in.

## Status / roadmap

**Working, fun-validated prototype** (3 external playtesters, one full clear).
Shipped: 3 levels with distinct maps/rosters and star-based unlock chain,
4×3 towers, 6 enemy families, roguelite runes (level-roster filtered),
daily runs (UTC-seeded, stream-forked determinism), endless mode,
press-and-hold rune peek, prep/wave sell-refund economy, PWA shell,
33-check CDP e2e suite, iPhone delivery guide.

Next, in order: balance pass on levels 2–3 (tables authored, untuned) →
save export/import codes → host the public demo (Vercel/GH Pages —
`docs/IPHONE_GUIDE.md`) → scale content toward the 30-level goal →
Capacitor/TestFlight when a Mac is available. Deferred architecture
work is registered with triggers in `DEV_NOTES.md §7`.
