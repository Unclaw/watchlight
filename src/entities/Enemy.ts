// Murk creature. Ground foes walk the path; flyers cut straight across.
// Slows/burns use the scene's pause-aware game clock. All combat state and
// per-frame logic live in the shared core (src/sim/enemy.ts) — this entity
// wraps an EnemyCore and adds the Phaser visuals on top.
import Phaser from 'phaser';
import { EnemyKind, Pt } from '../config';
import type { GameScene } from '../scenes/GameScene';
import type { Rng } from '../rng';
import {
  applyBurnCore, applySlowCore, damageEnemyCore, EnemyCore, EnemyStepResult, healCore,
  isBossKind, posAheadCore, spawnEnemyCore, stepEnemyCore,
} from '../sim/enemy';

export class Enemy {
  readonly kind: EnemyKind;
  readonly scene: GameScene;
  /** Shared combat state — exposed for the smoke hooks; reads go through
   * the passthrough getters below. */
  readonly core: EnemyCore;
  sprite: Phaser.GameObjects.Image;

  private flashUntil = 0;
  /** Bark shroud while ROOTED — visual telegraph of splash hardening. */
  private barkRing?: Phaser.GameObjects.Graphics;
  private stepRes: EnemyStepResult = { leaked: false, burnKilled: false, summonDist: null, summonCount: 0 };
  /** Kill-pipeline idempotency: the shared core flips `alive` BEFORE the
   * scene's killEnemy sees the corpse, so the old `!e.alive` guard would
   * skip bounty/fx/destroy entirely (the white-ghost bug, W4.0-6). */
  private killClaimed = false;

  /** First caller wins the kill (bounty/fx/destroy run exactly once). */
  claimKill(): boolean {
    if (this.killClaimed) return false;
    this.killClaimed = true;
    return true;
  }

  constructor(scene: GameScene, kind: EnemyKind, wave: number, rng: Rng) {
    this.scene = scene;
    this.kind = kind;
    this.core = spawnEnemyCore(kind, wave, scene.level.hpMult, scene.level.map, rng);
    this.sprite = scene.add
      .image(0, 0, `enemy_${kind}`)
      .setScale(0.5 * this.core.variance) // textures are 2× supersampled
      .setDepth(20);
    if (kind === 'boss') this.sprite.setScale(0.5 + Math.min(0.15, (wave - 10) * 0.008));
    else if (isBossKind(kind)) this.sprite.setScale(0.5); // miniboss/heartwood textures authored at final size
  }

  // ---- state passthrough (shared core) ----
  get hp(): number { return this.core.hp; }
  set hp(v: number) { this.core.hp = v; }
  get maxHp(): number { return this.core.maxHp; }
  get speed(): number { return this.core.speed; }
  get armor(): number { return this.core.armor; }
  get bounty(): number { return this.core.bounty; }
  get alive(): boolean { return this.core.alive; }
  set alive(v: boolean) { this.core.alive = v; }
  /** Ground progress in px — public: documented smoke field + pack summons. */
  get dist(): number { return this.core.dist; }
  set dist(v: number) { this.core.dist = v; }
  get flyFrom(): Pt | null { return this.core.flyFrom; }
  get flyT(): number { return this.core.flyT; } // public: documented smoke field
  get x(): number { return this.core.x; }
  get y(): number { return this.core.y; }
  /** px remaining to the Lantern — targeting sort key (smaller = more urgent). */
  get remaining(): number { return this.core.remaining; }

  get isBoss(): boolean {
    return isBossKind(this.kind);
  }

  /** Place a ground foe at a given path distance (used by pack summons so
   * the Heartwood's runners drop in BEHIND it, then overtake on foot). */
  dropAt(dist: number): void {
    this.core.dist = Math.max(0, dist);
  }

  /** Returns 'leak' when the creature reaches the Lantern. */
  update(dtMs: number): 'leak' | null {
    const t = this.scene.gameTime;
    const res = stepEnemyCore(
      this.core, this, dtMs, t, this.scene.path, this.scene.enemies,
      (peer) => this.scene.healMotes(peer), this.stepRes,
    );
    // flyer dip (visual, but baked into y so targeting sees it too — the
    // sim deliberately models the straight line)
    if (this.core.flyFrom) this.core.y -= Math.sin(this.core.flyT * Math.PI) * 26;
    this.sprite.setPosition(this.x, this.y);

    // bark shroud: while ROOTED the Heartwood hardens vs splash — say so in
    // the shared visual language (amber 12-gon, same as the rooted boss bar)
    const rooted = t < this.core.rootUntil;
    if (rooted && !this.barkRing) this.barkRing = this.scene.add.graphics().setDepth(19);
    if (this.barkRing) {
      if (!rooted) {
        this.barkRing.destroy();
        this.barkRing = undefined;
      } else {
        const pulse = 0.5 + Math.sin(t / 150) * 0.2;
        this.barkRing.clear();
        this.barkRing.lineStyle(3, 0xffc24b, pulse);
        const r = 54;
        this.barkRing.beginPath();
        for (let i = 0; i <= 12; i++) {
          const a = (i / 12) * Math.PI * 2 + Math.PI / 12;
          const px = this.x + Math.cos(a) * r;
          const py = this.y + Math.sin(a) * r;
          if (i === 0) this.barkRing.moveTo(px, py);
          else this.barkRing.lineTo(px, py);
        }
        this.barkRing.strokePath();
      }
    }

    // tint: white hit-flash wins briefly, then bark while rooted, cold
    // violet while slowed, white otherwise
    if (t >= this.flashUntil) {
      this.sprite.setTint(rooted ? 0xd9c08a : t < this.core.slowUntil ? 0x9b8cff : 0xffffff);
    }

    if (res.burnKilled) {
      this.scene.killEnemy(this);
      return null;
    }
    if (res.summonDist !== null) this.scene.summonPack(this, res.summonCount);
    if (res.leaked) return 'leak';
    return null;
  }

  /** Returns true if this hit killed the creature. `splash` hits are
   * halved against a rooted Heartwood (bark — see damageEnemyCore). */
  damage(amount: number, flash = true, splash = false): boolean {
    const killed = damageEnemyCore(this.core, amount, this.scene.gameTime, splash);
    if (flash) this.flashWhite();
    if (killed) {
      this.scene.killEnemy(this);
      return true;
    }
    return false;
  }

  applySlow(factor: number, until: number): void {
    applySlowCore(this.core, factor, until, this.scene.gameTime);
  }

  applyBurn(dps: number, until: number): void {
    applyBurnCore(this.core, dps, until);
  }

  /** Brief white hit-flash (overrides the slow tint momentarily). */
  flashWhite(): void {
    this.sprite.setTintFill(0xffffff);
    this.flashUntil = this.scene.gameTime + 70;
  }

  /** Predicted position ~ms in the future (used to lead mortar shells). */
  posAhead(ms: number): { x: number; y: number } {
    return posAheadCore(this.core, ms, this.scene.gameTime, this.scene.path);
  }

  heal(amount: number): void {
    healCore(this.core, amount);
  }

  destroy(): void {
    this.barkRing?.destroy();
    this.barkRing = undefined;
    this.sprite.destroy();
  }
}
