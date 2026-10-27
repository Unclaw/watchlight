# Tech stack — what we use and why

The implementation stack of Watchlight, layer by layer, with the reasoning
and the alternatives that were rejected. Market/positioning rationale lives
in the original research decision log; this file is about the
*engineering* choices. See `ARCHITECTURE.md` for how the code is organized.

---

## At a glance

| Layer | Choice | Replaces |
|---|---|---|
| Language | TypeScript (strict) | JavaScript |
| Bundler / dev server | Vite 7 | webpack, esbuild-configs, parcel |
| Engine | Phaser 3.90 | PixiJS + DIY, vanilla Canvas |
| UI | Phaser game objects only | DOM/React overlay |
| Art | Procedural vector-glow textures, generated at boot | sprite atlases, raster exports |
| Audio | Procedural WebAudio synthesis | audio files, Howler etc. |
| Persistence | localStorage (versioned key) | IndexedDB, server, sqlite |
| App shell | Hand-rolled PWA (manifest + SW) | vite-plugin-pwa, Workbox |
| Native wrapper | Capacitor-ready config, no dependency yet | Cordova, React Native, native rewrite |

Only two runtime dependencies ship to the player: **phaser** and our code.
Everything else is dev tooling.

---

## Language: TypeScript (strict)

- **Why:** a TD is logic-dense (economy, waves, targeting, rune modifiers) and
  stateful; type errors here are gameplay bugs. Strict mode + `noUnusedLocals`
  caught several real bugs at compile time during development (e.g. number vs
  string colour arguments reaching text styles).
- **Trade-off:** none meaningful. Phaser ships first-party types.
- **Note:** compile-time privacy is not runtime privacy — the CDP test suite
  reads "private" fields through the bundle (see `DEV_NOTES.md §4`).

## Bundler: Vite

- **Why:** instant HMR for iteration; zero-config TS/ESM handling; the dev
  server binds `0.0.0.0:3000` matching the environment's preview bridge; the
  production build is a static folder any host (or a WKWebView via `file://`)
  can serve. `base: './'` keeps it Capacitor-friendly.
- **Alternatives:** webpack (config tax for zero gain), plain esbuild (fine,
  but we'd hand-roll dev serving/HMR anyway).
- **Build output measured:** single ~1.25 MB JS bundle, **342 KB gzipped
  transferred** — inside the <1.5 MB JS budget from the research, with
  code-splitting deliberately unnecessary (see "What we don't use").

## Engine: Phaser 3

The decision matrix from the research (§5.2), confirmed by building on it:

| Criterion | Phaser 3 | PixiJS v8 | Vanilla Canvas |
|---|---|---|---|
| Scenes, input, audio, tweens, particles included | ✔ | ✖ (DIY) | ✖ |
| Bundle | ~1.2 MB | ~450 KB | 0 |
| Raw render throughput | good | ~2× | n/a |
| Dev speed for a complete game | best | slow | slowest |

- **Why Phaser:** this game is *logic-bound, not render-bound* (≤ ~200
  entities, one small texture set). PixiJS's rendering advantage buys nothing
  we can feel, while Phaser's built-ins (Scene lifecycle, input hit-testing,
  TweenManager, particle emitters, Scale Manager) removed weeks of plumbing.
  The 1.2 MB cost gzips to ~350 KB.
- **What we don't use from Phaser:** physics (arcade/matter — none needed for
  a path TD), cameras beyond basic flash/shake, tilemaps (path is data +
  Graphics), the asset loader (everything is generated or code).
- **Fallback documented:** if profiling ever shows renderer overhead, PixiJS
  is the pre-agreed escape hatch (research §5.2).

## UI: Phaser-native, no DOM overlay

- **Why:** the whole screen is the game; DOM chrome would duplicate the
  coordinate systems and fight iOS viewport quirks twice. One canvas, one
  input system, one letterboxed FIT layout (`720×1280` logical, CSS-scaled —
  also sidesteps the iOS canvas-resize leak).
- **Trade-off:** no free accessibility/native widgets. Mitigated with big
  touch targets, an `aria-label` on the canvas, and PWA chrome for the rest.
- **One-thumb rule:** interactive controls live in the bottom third; anything
  overlapping gameplay is deliberately tap-through (`DEV_NOTES.md §3`).

## Art: procedural "flat vector glow" textures

- **Why:** the approved art direction (research D5) *and* an engineering win:
  zero binary assets, total palette control, style consistency by
  construction, and a trivially small GPU footprint (~2.4 MB of generated
  textures, all ≤1024², against a 256 MB old-device budget).
- **How:** `BootScene` draws every sprite (enemies, towers, lantern, rings,
  beams, chevrons) with Graphics at **2× supersample**, displayed at ×0.5 for
  crispness on 3× screens. PWA icons come from `scripts/gen-icons.mjs` — a
  dependency-free PNG encoder with the same art language.
- **Alternatives rejected:** raster atlas (style drift risk, pipeline cost,
  licensing), runtime SVG (inconsistent perf), spine/skeletal animation
  (overkill).

## Audio: procedural WebAudio

- **Why:** zero-byte SFX budget, no licensing, and precise control over iOS
  rules that matter more than fidelity: AudioContext is created/resumed
  strictly inside a real gesture handler; a **14-voice pool** caps
  simultaneous sounds; every cue name has a throttle map so ×2 speed can't
  machine-gun the mixer. Ambient pad is two detuned oscillators + filtered
  noise at very low gain.
- **Trade-off:** synthesised timbres are minimal by design — matches the
  minimalist art. If we ever want music, the ≤1 MB ambient budget from the
  research is the slot.

## Persistence: localStorage

- **Why:** the save is a few hundred bytes of counters and settings; sync
  localStorage calls are unmeasurable at our frame budget. Schema is keyed
  `watchlight.save.v1` with `patchSave` merge semantics.
- **iOS context:** browser storage can be evicted after 7 days of ITP
  non-use, but **home-screen PWA storage is exempt** — one more reason the
  PWA is the primary install path. Export/import text codes are planned
  (research D8) rather than needing IndexedDB.

## App shell: hand-rolled PWA

- **Why:** the app is one page, one bundle, one canvas — a service worker
  with precache + stale-while-revalidate for same-origin GETs covers offline
  fully. `vite-plugin-pwa`/Workbox would add a dependency and a build-time
  coupling to generate what is currently ~80 readable lines.
- **Deliberate detail:** SW registers only in production builds (`import.meta
  .env.PROD`) so dev stays hot-reload-clean.

## Native wrapper: Capacitor (config only, for now)

- **Why:** the final iOS compile needs Xcode/macOS, which this environment
  cannot provide (research §5.6). The repo stays one `npm i -D
  @capacitor/cli` + `npx cap add ios` away from a TestFlight build: relative
  asset paths, no server dependency, portrait lock, splash colours are
  already set in `capacitor.config.ts` and the manifest.
- **Alternatives rejected:** React Native/Flutter (full rewrite), Cordova
  (older WKWebView story).

## What we deliberately don't use

Every absence is a decision, listed here so refactors don't add them casually:

- **No UI framework** — DOM overlays rejected (see UI section).
- **No state-management library** — one Scene owns run state; save state is
  a single versioned object. At this scale, Redux/Zustand would be ceremony.
- **No code-splitting** — the bundle is one Phaser-sized file (~350 KB gz);
  splitting app-vs-engine saves nothing on first paint and complicates the SW.
- **No physics engine** — movement is path interpolation, collisions are
  distance checks. Adding arcade physics would be a regression in precision.
- **No analytics / crash SDK** — privacy stance; no telemetry in a
  non-commercial game.
- **No test-framework dependency yet** — the e2e harness is CDP over the
  real browser (see `TESTING.md`); unit-test runner can be added when there
  are units worth table-testing (e.g. wave math) without touching runtime.

## Performance budgets (research §5.4) vs measured

| Budget | Target | Measured (prototype) |
|---|---|---|
| Total transfer, first load | < 5 MB | **~350 KB** gz |
| JS payload | < 1.5 MB | 1.25 MB raw / 342 KB gz |
| GPU textures | < 64 MB | ~2.4 MB generated |
| Runtime RAM | < 150 MB | canvas game, no retained assets |
| First playable | < 5 s mid-tier iPhone | FCP 0.6 s / LCP 0.8 s on throttle |
| Frame rate | 60 steady | rAF-capped 60, logic-bound update |
