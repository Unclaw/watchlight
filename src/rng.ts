// Deterministic seeded RNG (mulberry32). The daily challenge derives its seed
// from the date so every player worldwide gets the identical run.
export class Rng {
  private s: number;

  constructor(seed: number) {
    this.s = seed >>> 0;
  }

  /** Deterministically derive an independent stream. Same (seed, salt) pair
   * always yields the same child sequence — lets each concern (wave
   * composition, combat variance, rune shuffles) consume randomness without
   * shifting any other stream. */
  fork(salt: number): Rng {
    return new Rng((this.s ^ Math.imul(salt, 0x9e3779b9)) >>> 0);
  }

  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  float(a: number, b: number): number {
    return a + this.next() * (b - a);
  }

  int(a: number, b: number): number {
    return Math.floor(this.float(a, b + 1));
  }

  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }

  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
}

/** UTC-derived so "same seed for everyone" holds across timezones.
 * Full YYYYMMDD — no year truncation, ~37k→full date range of seeds. */
export function todayDailySeed(): number {
  const d = new Date();
  return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
}
