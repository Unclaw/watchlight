// i18n — every player-facing string in one place.
//
// ★★★ EDIT TRANSLATIONS HERE ★★★
//   - `RU` below is the reviewed & approved Russian localization (2026-10-26).
//     Short is good: pills and cards are tight (notes in [brackets]).
//   - English lives in `EN` and is the fallback: a missing RU key simply
//     shows the English line.
//   - Preview with  ?lang=ru  on the game URL (e.g. preview → /?lang=ru,
//     or /?scene=game&lang=ru). No rebuild needed — it's a query param.
//   - Strings with {n} are interpolated; counted things (waves, wins) use
//     small functions with proper Russian plural forms via plural().
import { LEVELS, RuneDef, TowerKind, TOWERS } from './config';

export type Locale = 'en' | 'ru';

let locale: Locale = 'en';
export function setLocale(l: Locale): void {
  locale = l;
}
export function getLocale(): Locale {
  return locale;
}

/** Russian plural picker: 1 волна / 2 волны / 5 волн. */
export function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

// prettier-ignore
const EN = {
  // ---- menu ----
  tagline: 'hold the light against the Murk',
  noRuns: 'no runs yet — the night is young',
  daily: 'Daily Run · same seed for everyone',
  endless: 'Endless Night',
  endlessCta: 'Continue — Endless Night',
  soundOn: 'Sound · on',
  soundOff: 'Sound · off',
  howTo: 'How to Play',
  gotIt: 'Got it',
  howTitle: 'Keep the Lantern alive',
  how1: 'Tap a dim square → build a tower.',
  how2: 'Tap a tower → upgrade or sell.',
  how3: 'Every 5th wave, claim a rune.',
  how4: 'Shielded Murk shrugs off fast hits —',
  how5: 'bring beams and kilns.',
  how6: 'Clear every wave. No leaks = 3 stars.',
  // ---- hud / waves ----
  lv: 'Lv.',
  waves: (n: number) => `${n} ${n === 1 ? 'wave' : 'waves'}`,
  // ---- biome hub ----
  biomeWoodlands: 'The Woodlands',
  biomeDeepmarsh: 'The Deepmarsh',
  biomeAshen: 'The Ashen Wastes',
  comingSoon: 'Coming soon',
  levelsCleared: (n: number, total: number) => `${n} of ${total} cleared`,
  starsTotal: (n: number, total: number) => `${n} of ${total} ◆`,
  biomeLevels: (n: number) => `${n} levels`,
  back: 'Back',
  chooseLevel: 'Choose a level',
  stripNext: (n: number) => `NEXT · WAVE ${n}`,
  stripRemaining: (n: number) => `WAVE ${n} · REMAINING`,
  waveOf: (n: number, total: number) => `WAVE ${n}/${total}`,
  waveOnly: (n: number) => `WAVE ${n}`,
  waveDaily: (n: number) => `WAVE ${n} · DAILY`,
  startWave: (n: number) => `▶  Wave ${n}`,
  boss: 'BOSS',
  bossStirs: 'A BOSS STIRS',
  heartwoodStirs: 'THE HEARTWOOD WAKES',
  // ---- build sheet ----
  raiseTower: 'RAISE A TOWER',
  statDmg: 'damage',
  statRate: 'rate',
  statRange: 'range',
  tier: (n: number) => `Tier ${n}`,
  upgrade: 'Upgrade',
  maxTier: 'MAX TIER',
  sell: 'Sell',
  sellFull: '(100%)',
  goldUnit: 'g',
  // ---- runes ----
  runeHeader: 'THE LANTERN OFFERS A RUNE',
  runeSub: 'choose one — it lasts this run',
  runeList: (n: number) => `RUNES · ${n}`,
  runeClaimed: 'RUNE CLAIMED',
  // ---- pause / end ----
  paused: 'PAUSED',
  resume: 'Resume',
  restartRun: 'Restart run',
  leaveToMenu: 'Leave to menu',
  winTitle: 'THE LANTERN ENDURES',
  loseTitle: 'THE LANTERN DIMS',
  stWaves: 'waves survived',
  stKills: 'murk felled',
  stLeaks: 'leaks',
  stGold: 'gold earned',
  newRun: 'New run',
  menu: 'Menu',
  next: 'Next',
} as const;

export type StrKey = keyof typeof EN;
type Entry = string | ((n: number) => string) | ((n: number, total: number) => string);

// ★ RUSSIAN — reviewed & approved by the operator. Missing key → English.
// prettier-ignore
const RU: Partial<Record<StrKey, Entry>> = {
  // ---- menu ----  [daily pill: ≤ ~34 chars; card names wrap to 2 lines]
  tagline: 'Сохраняй свет против Мглы',
  noRuns: 'забегов нет — ночь ещё молода',
  daily: 'Ежедневный забег · общий сид',
  endless: 'Бесконечная ночь',
  endlessCta: 'Дальше — Бесконечная ночь',
  soundOn: 'Звук · вкл.',
  soundOff: 'Звук · выкл.',
  howTo: 'Как играть',
  gotIt: 'Понятно',
  howTitle: 'Защити фонарь от мглы',
  how1: 'Тапни тусклый квадрат → построй башню.',
  how2: 'Тапни башню → улучшить или продать.',
  how3: 'Каждая 5-я волна — выбор руны.',
  how4: 'Мглари с барьером не боятся частых ударов —',
  how5: 'Бери лучи и горны.',
  how6: 'Пройди все волны. Без утечек = 3 звезды.',
  // ---- hud / waves ----
  lv: 'Ур.',
  waves: (n: number) => `${n} ${plural(n, 'волна', 'волны', 'волн')}`,
  // ---- biome hub ----
  biomeWoodlands: 'Чаща',
  biomeDeepmarsh: 'Глубокая топь',
  biomeAshen: 'Пепельные пустоши',
  comingSoon: 'Скоро',
  levelsCleared: (n: number, total: number) => `пройдено ${n} из ${total}`,
  starsTotal: (n: number, total: number) => `◆ ${n} из ${total}`,
  biomeLevels: (n: number) => `${n} ${plural(n, 'уровень', 'уровня', 'уровней')}`,
  back: 'Назад',
  chooseLevel: 'Выбери уровень',
  stripNext: (n: number) => `ДАЛЕЕ · ВОЛНА ${n}`,
  stripRemaining: (n: number) => `ВОЛНА ${n} · ОСТАЛОСЬ`,
  waveOf: (n: number, total: number) => `ВОЛНА ${n}/${total}`,
  waveOnly: (n: number) => `ВОЛНА ${n}`,
  waveDaily: (n: number) => `ВОЛНА ${n} · ЕЖЕДНЕВНАЯ`,
  startWave: (n: number) => `▶  Волна ${n}`,
  boss: 'БОСС',
  bossStirs: 'БОСС ПРОБУЖДАЕТСЯ',
  heartwoodStirs: 'СЕРДЦЕДРЕВО ПРОБУЖДАЕТСЯ',
  // ---- build sheet ----  [chip ≤ ~16 chars; stat labels ≤ 8]
  raiseTower: 'ВОЗВЕСТИ БАШНЮ',
  statDmg: 'урон',
  statRate: 'темп',
  statRange: 'радиус',
  tier: (n: number) => `ранг ${n}`,
  upgrade: 'Улучшить',
  maxTier: 'МАКС. РАНГ',
  sell: 'Продать',
  sellFull: '(100%)',
  goldUnit: 'з.',
  // ---- runes ----
  runeHeader: 'ФОНАРЬ ПРЕДЛАГАЕТ РУНУ',
  runeSub: 'Выбери одну — до конца забега',
  runeList: (n: number) => `РУНЫ · ${n}`,
  runeClaimed: 'РУНА ПОЛУЧЕНА',
  // ---- pause / end ----
  paused: 'ПАУЗА',
  resume: 'Продолжить',
  restartRun: 'Заново',
  leaveToMenu: 'В меню',
  winTitle: 'ФОНАРЬ СВЕТИТ',
  loseTitle: 'ФОНАРЬ ПОГАС',
  stWaves: 'Волн пройдено',
  stKills: 'Врагов повержено',
  stLeaks: 'Утечек',
  stGold: 'золота добыто',
  newRun: 'Ещё раз',
  menu: 'Меню',
  next: 'Далее',
};

function entry(key: StrKey): Entry {
  const ru = RU[key];
  return locale === 'ru' && ru !== undefined ? ru : (EN[key] as Entry);
}

/** Simple string lookup (optionally interpolates {n}). */
export function t(key: StrKey, params?: Record<string, string | number>): string {
  let v = entry(key);
  if (typeof v === 'function') v = (v as (n: number) => string)(0);
  if (params) for (const [k, val] of Object.entries(params)) v = v.split(`{${k}}`).join(String(val));
  return v;
}

/** Counted string lookup: passes the number to the entry's function. */
export function tN<A extends number[]>(key: StrKey, ...nums: A): string {
  const v = entry(key);
  return typeof v === 'function' ? (v as (...a: number[]) => string)(...nums) : v;
}

/** Menu stats line (needs real plural forms). */
export function statsLine(bestWave: number, wins: number, kills: number): string {
  if (locale === 'ru') {
    return `лучшая волна ${bestWave} · ${plural(wins, 'победа', 'победы', 'побед')} · ${kills} повержено`;
  }
  return `best wave ${bestWave} · ${wins} ${wins === 1 ? 'win' : 'wins'} · ${kills} felled`;
}

// ---- content names (config stays canonical-English; display maps here) ----
// ★ Tower / rune / level names and blurbs — edit the RU_* tables below.
const RU_TOWERS: Partial<Record<TowerKind, { name: string; blurb: string }>> = {
  ember: { name: 'Спарк', blurb: 'частые искры' },
  prism: { name: 'Призма', blurb: 'луч' },
  halo: { name: 'Ореол', blurb: 'аура: замедление и урон' },
  kiln: { name: 'Горн', blurb: 'урон по площади' },
  grove: { name: 'Роща', blurb: 'усиливает соседние башни' },
};

const RU_RUNES: Partial<Record<string, { name: string; desc: string }>> = {
  emberChains: { name: 'Искровые цепи', desc: 'Искры бьют по 2 врагам рядом за 50% урона.' },
  focusLens: { name: 'Линза фокуса', desc: 'Урон призмы +35%.' },
  slowBurn: { name: 'Тление', desc: 'Ауры ореола поджигают: +8 урона в секунду.' },
  volatile: { name: 'Взрывной горн', desc: 'Радиус залпа горна +35%.' },
  overcharge: { name: 'Перегрузка', desc: 'Все башни стреляют на 15% быстрее.' },
  greed: { name: 'Жадность', desc: 'Все награды +30%.' },
  sturdy: { name: 'Крепкое сердце', desc: 'Фонарю +8 к запасу и полное восстановление.' },
  swift: { name: 'Быстрые руки', desc: 'Постройка и улучшение дешевле на 12%.' },
  farsight: { name: 'Дальний взгляд', desc: 'Радиус всех башен +12%.' },
  coldHeart: { name: 'Стужа', desc: 'Замедление ореола глубже (−20% скорости).' },
  fortune: { name: 'Удача', desc: 'Сразу +80 золота.' },
  quickspark: { name: 'Быстрая искра', desc: 'Спарк стреляет на 25% быстрее.' },
  wideLens: { name: 'Широкая линза', desc: 'Луч призмы шире на 45%.' },
  powderKeg: { name: 'Пороховой заряд', desc: 'Урон горна +30%.' },
  deepRoots: { name: 'Глубокие корни', desc: 'Радиус рощи +30%.' },
  oldGrowth: { name: 'Старый лес', desc: 'Усиление рощи мощнее в полтора раза.' },
};

const RU_LEVELS: Record<number, string> = {
  1: 'Переправа',
  2: 'Долгий Дозор',
  3: 'Спуск',
  4: 'Туманный лог',
  5: 'Терновый лабиринт',
  6: 'Лес огоньков',
  7: 'Старые тропы',
  8: 'Тихая роща',
  9: 'Дороги корней',
  10: 'Сердцевина',
};

export function towerName(kind: TowerKind): string {
  return (locale === 'ru' && RU_TOWERS[kind]?.name) || TOWERS[kind].name;
}
export function towerBlurb(kind: TowerKind): string {
  return (locale === 'ru' && RU_TOWERS[kind]?.blurb) || TOWERS[kind].blurb;
}
export function runeName(rune: RuneDef): string {
  return (locale === 'ru' && RU_RUNES[rune.id]?.name) || rune.name;
}
export function runeDesc(rune: RuneDef): string {
  return (locale === 'ru' && RU_RUNES[rune.id]?.desc) || rune.desc;
}
export function levelName(levelId: number): string {
  return (locale === 'ru' && RU_LEVELS[levelId]) || LEVELS[levelId - 1].name;
}
