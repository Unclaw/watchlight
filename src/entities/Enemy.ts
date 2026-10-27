// Murk creature. Ground foes walk the path; flyers cut straight across.
// Slows/burns use the scene's pause-aware game clock.
import Phaser from 'phaser';
import { COMBAT, ENEMIES, EnemyKind, waveScale, Pt } from '../config';
import type { GameScene } from '../scenes/GameScene';
import type { Rng } from '../rng';
import { audio } from '../audio';

export class Enemy {
  readonly kind: EnemyKind;
  readonly scene: GameScene;
  sprite: Phaser.GameObjects.Image;
  hp: number;
  maxHp: number;
  speed: number;
  armor: number;
  bounty: number;
  alive = true;

  private dist = 0; // ground progress (px along path)
  private flyFrom: Pt | null = null;
  private flyTo: Pt = { x: 0, y: 0 };
  private flyT = 0;
  private flyLen = 1;
  private slowFactor = 1;
  private slowUntil = 0;
  private burnDps = 0;
  private burnUntil = 0;
  private burnTick = 0;
  private healTick = 0;
  private flashUntil = 0;
  private variance: number;
  x = 0;
  y = 0;
  /** px remaining to the Lantern — targeting sort key (smaller = more urgent). */
  remaining = 0;

  constructor(scene: GameScene, kind: EnemyKind, wave: number, rng: Rng) {
    this.scene = scene;
    this.kind = kind;
    const def = ENEMIES[kind];
    const scale =
      kind === 'boss' ? 1 + COMBAT.bossHpRamp * (wave - COMBAT.bossHpAnchorWave) : waveScale(wave);
    this.maxHp = Math.round(def.hp * scale * scene.level.hpMult);
    this.hp = this.maxHp;
    this.speed = def.speed * rng.float(COMBAT.varianceMin, COMBAT.varianceMax);
    this.armor = def.armor + Math.floor(wave / COMBAT.armorPerWaves);
    this.bounty = def.bounty;
    this.variance = rng.float(0.92, 1.08);

    this.sprite = scene.add
      .image(0, 0, `enemy_${kind}`)
      .setScale(0.5 * this.variance) // textures are 2× supersampled
      .setDepth(20);
    if (kind === 'boss') this.sprite.setScale(0.5 + Math.min(0.15, (wave - 10) * 0.008));

    if (kind === 'flyer') {
      const from = rng.pick(scene.level.map.flyerSpawns);
      const to = scene.level.map.lantern;
      this.flyFrom = from;
      this.flyTo = to;
      this.flyLen = Phaser.Math.Distance.Between(from.x, from.y, to.x, to.y);
      this.x = from.x;
      this.y = from.y;
    }
  }

  get isBoss(): boolean {
    return this.kind === 'boss';
  }

  /** Returns 'leak' when the creature reaches the Lantern. */
  update(dtMs: number): 'leak' | null {
    const t = this.scene.gameTime;
    const slowed = t < this.slowUntil ? this.slowFactor : 1;
    const v = (this.speed * slowed * dtMs) / 1000;

    if (this.flyFrom) {
      this.flyT += v / this.flyLen;
      this.x = Phaser.Math.Linear(this.flyFrom.x, this.flyTo.x, this.flyT);
      this.y = Phaser.Math.Linear(this.flyFrom.y, this.flyTo.y, this.flyT) - Math.sin(this.flyT * Math.PI) * 26;
      this.remaining = (1 - this.flyT) * this.flyLen;
    } else {
      this.dist += v;
      const p = this.scene.path.posAt(this.dist);
      this.x = p.x;
      this.y = p.y;
      this.remaining = this.scene.path.len - this.dist;
    }
    this.sprite.setPosition(this.x, this.y);

    // tint: white hit-flash wins briefly, then cold violet while slowed
    if (t >= this.flashUntil) {
      this.sprite.setTint(t < this.slowUntil ? 0x9b8cff : 0xffffff);
    }

    // burn ticks (armor-ignoring)
    if (t < this.burnUntil && this.burnDps > 0) {
      this.burnTick += dtMs;
      if (this.burnTick >= 250) {
        this.hp -= (this.burnDps * this.burnTick) / 1000;
        this.burnTick = 0;
        if (this.hp <= 0) {
          this.scene.killEnemy(this, false);
          return null;
        }
      }
    }

    // healer aura: 2.5% max HP to neighbours, twice a second
    if (this.kind === 'healer') {
      this.healTick += dtMs;
      if (this.healTick >= COMBAT.healerTickMs) {
        this.healTick = 0;
        let healed = false;
        for (const e of this.scene.enemies) {
          if (e === this || !e.alive || e.hp >= e.maxHp) continue;
          if (Phaser.Math.Distance.Between(this.x, this.y, e.x, e.y) < COMBAT.healerRadius) {
            e.heal(e.maxHp * COMBAT.healerHealPct);
            healed = true;
          }
        }
        if (healed) audio.play('heal');
      }
    }

    if (this.remaining <= 0) {
      this.alive = false;
      return 'leak';
    }
    return null;
  }

  /** Returns true if this hit killed the creature. */
  damage(amount: number, flash = true): boolean {
    const dmg = Math.max(1, amount - this.armor);
    this.hp -= dmg;
    if (flash) this.scene.flashWhite(this);
    if (this.hp <= 0) {
      this.scene.killEnemy(this, true);
      return true;
    }
    return false;
  }

  applySlow(factor: number, until: number): void {
    if (factor < this.slowFactor || this.scene.gameTime >= this.slowUntil) this.slowFactor = factor;
    this.slowUntil = Math.max(this.slowUntil, until);
  }

  applyBurn(dps: number, until: number): void {
    this.burnDps = Math.max(this.burnDps, dps);
    this.burnUntil = Math.max(this.burnUntil, until);
  }

  /** Brief white hit-flash (overrides the slow tint momentarily). */
  flashWhite(): void {
    this.sprite.setTintFill(0xffffff);
    this.flashUntil = this.scene.gameTime + 70;
  }

  /** Predicted position ~ms in the future (used to lead mortar shells). */
  posAhead(ms: number): { x: number; y: number } {
    const v = this.speed * (this.scene.gameTime < this.slowUntil ? this.slowFactor : 1);
    const lead = Math.min(this.remaining, (v * ms) / 1000);
    if (this.flyFrom) {
      const t = Phaser.Math.Clamp(this.flyT + lead / this.flyLen, 0, 1);
      return {
        x: Phaser.Math.Linear(this.flyFrom.x, this.flyTo.x, t),
        y: Phaser.Math.Linear(this.flyFrom.y, this.flyTo.y, t),
      };
    }
    return this.scene.path.posAt(this.scene.path.len - this.remaining + lead);
  }

  heal(amount: number): void {
    this.hp = Math.min(this.maxHp, this.hp + amount);
  }

  destroy(): void {
    this.sprite.destroy();
  }
}
