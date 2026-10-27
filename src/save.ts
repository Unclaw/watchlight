// localStorage persistence. Home-screen PWA storage is ITP-exempt on iOS;
// export/import codes are planned for a later milestone (see research D8).
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
  /** Interface language. 'auto' = follow the device language. */
  lang: 'en' | 'ru' | 'auto';
}

const KEY = 'watchlight.save.v1'; // pre-alpha rename from lanternkeep.save.v1 (no users to migrate)

const DEFAULTS: SaveData = {
  bestWave: 0,
  wins: 0,
  runs: 0,
  totalKills: 0,
  mute: false,
  wonOnce: false,
  daily: null,
  levelStars: {},
  lang: 'auto',
};

export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<SaveData>) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function writeSave(data: SaveData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // Storage unavailable (private mode) — run stays in-memory.
  }
}

export function patchSave(patch: Partial<SaveData>): SaveData {
  const next = { ...loadSave(), ...patch };
  writeSave(next);
  return next;
}
