// localStorage persistence. Home-screen PWA storage is ITP-exempt on iOS;
// export/import codes are planned for a later milestone (README roadmap).
//
// SCHEMA MIGRATION (L1): ONE storage key; the payload is an envelope
// `{ v: <schemaVersion>, data: <SaveData> }`. On load, ordered MIGRATIONS
// transforms upgrade older payloads to SCHEMA_VERSION, missing fields are
// deep-defaulted (nested objects like levelStars/daily get new-key
// defaults instead of silently staying absent), and the result is written
// back. Legacy pre-envelope keys (bare SaveData, no `v`) are adopted on
// first load and removed after a successful migrated write — v0.4.0 alpha
// testers carry real saves, so migrations must never discard progress.
export interface SaveData {
  bestWave: number; // best wave reached in any normal run
  wins: number;
  runs: number;
  totalKills: number;
  mute: boolean;
  wonOnce: boolean;
  daily: { date: number; wave: number } | null;
  /** Stars (0-3) per cleared level id. */
  levelStars: Record<number, number>;
  /** Seen one-time mechanic tips, keyed by level id (additive — deep-defaults
   * fill this for older saves, no schema bump needed). */
  tips: Record<number, boolean>;
  /** Interface language. 'auto' = follow the device language. */
  lang: 'en' | 'ru' | 'auto';
}

const KEY = 'watchlight.save';
/** Keys written before the envelope landed (bare SaveData payloads). */
const LEGACY_KEYS = ['watchlight.save.v1'];
/** Current payload version — bump per schema change, add a MIGRATIONS entry. */
const SCHEMA_VERSION = 1;
/** MIGRATIONS[i] upgrades a payload from schema v=i+1 to v=i+2, in order. */
const MIGRATIONS: ((data: unknown) => unknown)[] = [
  // (none yet — v1 is current)
];

const DEFAULTS: SaveData = {
  bestWave: 0,
  wins: 0,
  runs: 0,
  totalKills: 0,
  mute: false,
  wonOnce: false,
  daily: null,
  levelStars: {},
  tips: {},
  lang: 'auto',
};

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Deep-apply defaults: `stored` wins where present; nested plain objects
 * merge key-by-key so NEW nested fields default instead of staying absent
 * (the old shallow spread let them silently through as undefined). Unknown
 * keys from newer saves are preserved (forward tolerance). */
function deepMerge<T>(defaults: T, stored: unknown): T {
  if (stored === undefined) return defaults;
  if (isPlainObject(defaults) && isPlainObject(stored)) {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(defaults)) out[k] = deepMerge(defaults[k], stored[k]);
    for (const k of Object.keys(stored)) if (!(k in out)) out[k] = stored[k];
    return out as T;
  }
  return stored as T;
}

/** Envelope `{v, data}` since schema v1-envelope; a bare object is a legacy
 * (pre-envelope) payload — treated as v1 SaveData. */
function parsePayload(raw: string): { v: number; data: unknown } | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (isPlainObject(parsed) && typeof parsed.v === 'number' && 'data' in parsed) {
      return { v: parsed.v, data: parsed.data };
    }
    return { v: 1, data: parsed };
  } catch {
    return null;
  }
}

function persist(data: SaveData): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify({ v: SCHEMA_VERSION, data }));
    return true;
  } catch {
    return false; // Storage unavailable (private mode) — run stays in-memory.
  }
}

export function loadSave(): SaveData {
  try {
    let raw = localStorage.getItem(KEY);
    let fromLegacy = false;
    if (raw === null) {
      for (const k of LEGACY_KEYS) {
        const legacy = localStorage.getItem(k);
        if (legacy !== null) {
          raw = legacy;
          fromLegacy = true;
          break;
        }
      }
    }
    if (raw === null) return deepMerge(DEFAULTS, undefined);

    const parsed = parsePayload(raw);
    if (!parsed) return deepMerge(DEFAULTS, undefined);

    let v = parsed.v;
    let data = parsed.data;
    // Older payloads walk the transform chain; NEWER payloads (user
    // downgraded the app) pass through — deep defaults absorb unknown shape.
    while (v < SCHEMA_VERSION && v >= 1) {
      data = MIGRATIONS[v - 1](data);
      v++;
    }
    const merged = deepMerge(DEFAULTS, data);
    if (fromLegacy || parsed.v !== SCHEMA_VERSION) {
      if (persist(merged)) for (const k of LEGACY_KEYS) localStorage.removeItem(k);
    }
    return merged;
  } catch {
    return deepMerge(DEFAULTS, undefined);
  }
}

export function writeSave(data: SaveData): void {
  persist(data);
}

export function patchSave(patch: Partial<SaveData>): SaveData {
  // deepMerge (not spread): nested-object patches merge key-by-key instead
  // of clobbering the whole record.
  const next = deepMerge(loadSave(), patch);
  persist(next);
  return next;
}
