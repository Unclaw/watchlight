# Testing — strategy, harness, budgets

What we test, how, and the environment traps the harness already encodes.
Runtime-field contracts and headless quirks are in `DEV_NOTES.md §4`; this
file explains the *strategy*.

---

## Layers

| Layer | Tool | Gate | Time |
|---|---|---|---|
| Types | `tsc --noEmit` (strict) | part of `npm run build` | ~2 s |
| Build | Vite production build | must emit `dist/` | ~3 s |
| E2E gameplay | `scripts/cdp-smoke.mjs` (32 checks) | run manually / pre-commit | ~80 s |
| Render smoke | `scripts/check-shot.mjs` + screenshot | pixel-coverage sanity | ~10 s |
| Budgets | Lighthouse via `lh` | transfer/first-paint budgets | ~1 min |
| Manual | iPhone Safari → Add to Home Screen | touch feel, audio unlock, PWA | human |

The e2e suite is the real contract: it clicks the actual canvas with CDP
input events and asserts game state through `window.__game`.

## What the 32 e2e checks cover

1. Scene boots with all 14 buildable tiles wired to live zones.
2. Wave strip shows the upcoming mix during prep.
3. Tile tap opens the build sheet; tower card builds it; gold accounting is
   exact; sheet closes.
4. Upgrade chevron appears when affordable, disappears when broke.
5. Live affordability: sheet open while broke shows nothing affordable; gold
   arriving lights all cards up without reopening; dim tap closes.
6. Halo tower carries its influence ring at the correct radius.
7. Starting the wave switches the strip to remaining-tracker mode; enemies
   actually spawn.
8. A leaked enemy is absorbed (sprite destroyed) — lantern stays clean.
9. Rune flow: overlay after wave 5 → icon/card render order pinned
   (icons above cards) → offered runes match the level's tower
   roster (no dead picks) → strip hidden while pending → pick → strip shows
   wave 6 → rune button takes the icon and its card expands/collapses.
   Roster matching is re-verified on levels 2 and 3 via scene restart.
   Lantern glow starts dimmed (70%) with no runes.
10. Sell economics: prep sell = exact full refund and sell-spam is zero-sum;
    wave sell = 60% floor and sell-spam strictly loses gold (atomic evals so
    bounty events can't drift the numbers).
11. Two simultaneous bosses → boss bar visible (stacked bars).
12. Zero console errors/exceptions across the whole session.

## Why CDP (no puppeteer/playwright)

- Node ≥22 ships a native WebSocket; the DevTools Protocol is ~100 lines of
  helper — zero dependencies added (repo policy: runtime deps are phaser
  only; test deps kept at zero too).
- CDP `Input.dispatchMouseEvent` produces **trusted input events** through
  the real canvas → Phaser's Scale Manager, hit-testing, and audio-unlock
  path all execute exactly as on a device. DOM-level `.click()` or calling
  handlers directly would bypass the input pipeline we most need covered.
- `Runtime.evaluate` reads state deterministically (console scraping races —
  see DEV_NOTES §4.4).

## Harness patterns (copy these, don't rediscover them)

- **Wake click first**: rAF is frozen until the first real input in this
  headless build; click a non-interactive path point before asserting
  anything time-based.
- **`waitFor(expr)` polling, never fixed sleeps**: software WebGL runs game
  time ~0.4× wall clock.
- **Single-expression state access**: the `state()` helper wraps `return
  (${expr});` — chain multiple assignments with commas.
- **Always `timeout` the chromium invocation** — it may render+write the
  screenshot and still never exit.

## Pixel smoke (`check-shot.mjs`)

A dependency-free PNG decoder (inflate + unfilter) that reports colour
coverage per palette family. Good for: "did the menu/game render at all",
"are all four tower colours present", "did green chevrons appear". Not good
for small/UI assertions — those belong in e2e state checks (the chevron
lesson: pixel deltas were ~0.04%, unreadable; state assertion was exact).

## Performance budgets (enforced by Lighthouse `lh`)

| Metric | Target | Last measured |
|---|---|---|
| Transfer | < 5 MB | 344 KB gz |
| First contentful paint | fast enough to hit <5 s playable | 0.6 s |
| CLS | 0 | 0 |
| Best practices | pass | 1.0 |

Note: Lighthouse's TBT/score is pessimistic for canvas games (one-time
Phaser parse under 4× CPU throttle); the research budgets gate on transfer,
first playable and runtime fps instead.

## Known gaps (deliberate, listed for the refactor)

- No unit tests over pure logic (`waveScale`, path math, RNG sequences) —
  the natural first unit suite; zero test deps policy means a tiny runner or
  `node --test` on compiled TS.
- No soak/perf assertions (fps counters) in CI.
- Balance is human-tested only; the demo hook exists to replay waves for it.
- No multi-viewport/orientation tests (game is portrait-locked by design).
- Coordinates of taps are hardcoded (see DEV_NOTES §4 "Tile/card
  coordinates") — layout changes must update the script in the same commit.
