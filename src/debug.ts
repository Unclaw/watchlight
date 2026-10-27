// Debug & CI hooks — all ?query params parsed once, in one place.
// These are the smoke-suite's control surface (see docs/TESTING.md); they
// cost nothing in normal play and never gate gameplay logic.
const params = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');

export const DEBUG = {
  /** Jump straight to a scene ('game') instead of the menu. */
  jumpScene: params.get('scene'),
  /** Mode override for the scene jump (level | daily | endless). */
  jumpMode: (params.get('mode') as 'level' | 'daily' | 'endless' | null) ?? undefined,
  /** Level id for the scene jump (1-based). */
  jumpLevel: Number(params.get('level') ?? '1') || 1,
  /** Auto-start the first wave. */
  auto: params.get('auto') === '1',
  /** CI demo: auto-build one of each tower and chain waves. */
  demo: params.get('demo') === '1',
  /** CI: reproduce the in-game Restart path once, mid-run. */
  restart: params.get('restart') === '1',
  /** CI: in-page assertions via console SMOKE_ASSERT. */
  assert: params.get('assert') === '1',
  /** Locale override (en | ru) — preview with ?lang=ru. */
  lang: (params.get('lang') as 'en' | 'ru' | null) ?? undefined,
} as const;

/** Mutable holder for one-shot debug behaviours (restart fires once). */
export const debugState = { restartFired: false };
