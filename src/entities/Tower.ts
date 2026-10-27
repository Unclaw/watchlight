// Defender towers. Firing cadence is a manual accumulator so pause and the
// 2× speed toggle stay exact (no reliance on Phaser timers for gameplay).
import Phaser from 'phaser';
import { COMBAT, ECONOMY, TOWERS, TowerDef, TowerKind } from '../config';
import type { GameScene } from '../scenes/GameScene';
import { rateMult, rangeMult, prismDmgMult, splashMult, slowMult, costMult, hasSlowBurn } from '../runes';
import type { Enemy } from './Enemy';

export class Tower {
  readonly kind: TowerKind;
  readonly def: TowerDef;
  readonly scene: GameScene;
  readonly tileIndex: number;
  readonly x: number;
  readonly y: number;
  tier = 0; // 0,1,2 → display tiers 1..3
  invested: number;

  sprite: Phaser.GameObjects.Image;
  private pips: Phaser.GameObjects.Graphics;
  private upMarker: Phaser.GameObjects.Image;
  /** Halo only: persistent ground ring showing the aura's area of effect. */
  private auraRing: Phaser.GameObjects.Arc | null = null;
  private lastPulse = -1e9;
  private cooldown = 0;
  private auraTick = 0;
  private ringPulse = 0;

  constructor(scene: GameScene, kind: TowerKind, tileIndex: number, x: number, y: number, cost: number) {
    this.scene = scene;
    this.kind = kind;
    this.def = TOWERS[kind];
    this.tileIndex = tileIndex;
    this.x = x;
    this.y = y;
    this.invested = cost;

    this.sprite = scene.add.image(x, y, `tower_${kind}`).setScale(0.5).setDepth(15);
    this.pips = scene.add.graphics().setDepth(16);
    this.drawPips();
    this.popIn();

    // "upgrade affordable" marker — shown/hidden by the scene's HUD pass
    this.upMarker = scene.add
      .image(x, y - 38, 'up_arrow')
      .setScale(0.4)
      .setTint(0x47e0a0)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(17)
      .setVisible(false);
    scene.tweens.add({
      targets: this.upMarker,
      y: y - 44,
      duration: 700,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
    if (kind === 'halo') {
      // persistent influence ring: faint violet disc + stroke on the ground
      this.auraRing = scene.add
        .arc(x, y, 10)
        .setDepth(2)
        .setStrokeStyle(2, 0x9b8cff, 0.28)
        .setFillStyle(0x9b8cff, 0.045);
      this.refreshAura();
    }
  }

  /** Halo: resize the influence ring (call after range changes). */
  refreshAura(): void {
    if (this.auraRing) this.auraRing.setRadius(this.range);
  }
  /** Show/hide the green chevron when the next tier is affordable. */
  setUpgradeAvailable(on: boolean): void {
    if (on === this.upMarker.visible) return;
    this.upMarker.setVisible(on);
    if (on) {
      this.upMarker.setScale(0.15);
      this.scene.tweens.add({
        targets: this.upMarker,
        scale: 0.4,
        duration: 240,
        ease: 'Back.easeOut',
      });
    }
  }

  private popIn(): void {
    this.sprite.setScale(0.2);
    this.scene.tweens.add({
      targets: this.sprite,
      scale: 0.5,
      duration: 260,
      ease: 'Back.easeOut',
    });
  }

  private drawPips(): void {
    this.pips.clear();
    const r = 4;
    for (let i = 0; i <= this.tier; i++) {
      this.pips.fillStyle(0xeef2ff, 0.95);
      this.pips.fillCircle(this.x - 12 + i * 12, this.y + 30, r);
    }
  }

  // ---- effective stats (runes applied) ----
  get range(): number {
    const r = this.def.tiers[this.tier].range * rangeMult(this.scene.runes);
    return r;
  }
  get rate(): number {
    return this.def.tiers[this.tier].rate * rateMult(this.scene.runes);
  }
  get dmg(): number {
    const base = this.def.tiers[this.tier].dmg;
    if (this.kind === 'prism') return base * prismDmgMult(this.scene.runes);
    return base;
  }
  get splash(): number {
    const s = this.def.tiers[this.tier].splash ?? 0;
    return s * splashMult(this.scene.runes);
  }
  get slow(): number {
    let s = this.def.tiers[this.tier].slow ?? 0.6;
    s *= slowMult(this.scene.runes);
    return s;
  }

  nextCost(): number | null {
    if (this.tier >= 2) return null;
    const c = this.def.tiers[this.tier + 1].cost;
    return Math.round(c * costMult(this.scene.runes));
  }

  upgrade(): void {
    if (this.tier >= 2) return;
    this.tier++;
    this.drawPips();
    this.popIn();
    this.refreshAura();
  }

  /** Refund depends on the phase AT SELL TIME: full before the wave starts,
   * penalised while it runs. Floored so sell+rebuild can never create gold. */
  get sellValue(): number {
    const rate = this.scene.phase === 'wave' ? ECONOMY.sellRefundWave : ECONOMY.sellRefundPrep;
    return Math.floor(this.invested * rate);
  }

  /** Current refund rate (0..1) — for UI labels. */
  get sellRate(): number {
    return this.scene.phase === 'wave' ? ECONOMY.sellRefundWave : ECONOMY.sellRefundPrep;
  }

  /** Pick the foe closest to the Lantern within range. */
  private acquire(enemies: Enemy[]): Enemy | null {
    let best: Enemy | null = null;
    const r2 = this.range * this.range;
    for (const e of enemies) {
      if (!e.alive) continue;
      const dx = e.x - this.x;
      const dy = e.y - this.y;
      if (dx * dx + dy * dy > r2) continue;
      if (!best || e.remaining < best.remaining) best = e;
    }
    return best;
  }

  update(dtMs: number, enemies: Enemy[]): void {
    if (this.kind === 'halo') {
      this.auraTick -= dtMs;
      this.ringPulse += dtMs;
      if (this.auraTick <= 0) {
        this.auraTick = 1000 / this.rate; // tier rate is live data (was hardcoded 500)
        const until = this.scene.gameTime + COMBAT.auraSlowMs;
        const r2 = this.range * this.range;
        let hits = 0;
        for (const e of enemies) {
          if (!e.alive) continue;
          const dx = e.x - this.x;
          const dy = e.y - this.y;
          if (dx * dx + dy * dy > r2) continue;
          e.applySlow(this.slow, until);
          if (hasSlowBurn(this.scene.runes)) e.applyBurn(COMBAT.slowBurnDps, until);
          e.damage(this.dmg, false);
          hits++;
        }
        // clear rhythmic shockwave whenever the aura is biting, throttled
        if (hits > 0 && this.scene.gameTime - this.lastPulse >= 900) {
          this.lastPulse = this.scene.gameTime;
          this.scene.auraPulse(this);
        }
      }
      // gentle idle pulse of the aura ring
      const s = 0.5 + Math.sin(this.ringPulse / 900) * 0.015;
      this.sprite.setScale(s);
      return;
    }

    this.cooldown -= dtMs;
    if (this.cooldown > 0) return;
    const target = this.acquire(enemies);
    if (!target) return;
    this.cooldown = 1000 / this.rate;

    switch (this.kind) {
      case 'ember':
        this.scene.spawnBolt(this, target, this.dmg);
        break;
      case 'prism':
        this.scene.fireBeam(this, target);
        break;
      case 'kiln':
        this.scene.fireShell(this, target);
        break;
    }
  }

  get upgradeMarkerVisible(): boolean {
    return this.upMarker.visible;
  }

  destroy(): void {
    this.sprite.destroy();
    this.pips.destroy();
    this.upMarker.destroy();
    this.auraRing?.destroy();
  }
}
