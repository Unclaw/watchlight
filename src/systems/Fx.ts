// Fx — all combat/economy visual effects in one place.
// Owns the particle-emitter pool and every transient visual (beams, rings,
// shockwaves, floating text, absorbs). Pure visuals: no damage, no audio —
// gameplay side-effects stay in GameScene so effects can't hide logic.
import Phaser from 'phaser';
import { C, CSS, FONT } from '../theme';

const PALETTE: Record<string, number> = {
  red: 0xff5f7a,
  magenta: 0xe05fff,
  pink: 0xff5fd0,
  amber: 0xffc24b,
  cyan: 0x4fd8eb,
  violet: 0x9b8cff,
  white: 0xeef2ff,
};

export class Fx {
  private scene: Phaser.Scene;
  private emitters: Record<string, Phaser.GameObjects.Particles.ParticleEmitter> = {};

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    for (const [key, tint] of Object.entries(PALETTE)) {
      const em = scene.add.particles(0, 0, 'dot', {
        speed: { min: 40, max: 160 },
        angle: { min: 0, max: 360 },
        scale: { start: 0.28, end: 0 },
        lifespan: { min: 250, max: 550 },
        blendMode: 'ADD',
        tint,
        emitting: false,
      } as Phaser.Types.GameObjects.Particles.ParticleEmitterConfig);
      em.setDepth(40);
      this.emitters[key] = em;
    }
  }

  /** Particle burst in a palette colour. */
  burst(color: keyof typeof PALETTE, count: number, x: number, y: number): void {
    this.emitters[color].explode(count, x, y);
  }

  /** Instant beam (prism). Origin at left-centre, rotates to angle. */
  beam(x: number, y: number, angle: number, length: number, height: number, tint = 0x9fe8ff): void {
    const beam = this.scene.add
      .image(x, y, 'beam')
      .setOrigin(0, 0.5)
      .setRotation(angle)
      .setTint(tint)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(35);
    beam.displayWidth = length;
    beam.displayHeight = height;
    this.scene.tweens.add({
      targets: beam,
      alpha: 0,
      duration: 180,
      onComplete: () => beam.destroy(),
    });
  }

  /** Short-lived spark line (ember chain jumps). */
  sparkLine(x1: number, y1: number, x2: number, y2: number, tint = 0xffd88a): void {
    const spark = this.scene.add
      .image(x1, y1, 'beam')
      .setOrigin(0, 0.5)
      .setRotation(Math.atan2(y2 - y1, x2 - x1))
      .setTint(tint)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(35);
    spark.displayWidth = Phaser.Math.Distance.Between(x1, y1, x2, y2);
    spark.displayHeight = 6;
    this.scene.tweens.add({
      targets: spark,
      alpha: 0,
      duration: 150,
      onComplete: () => spark.destroy(),
    });
  }

  /** Expanding stroked ring — halo aura pulses. */
  shockwave(x: number, y: number, radius: number, tint = 0x9b8cff): void {
    const ring = this.scene.add
      .image(x, y, 'ring')
      .setTint(tint)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(22)
      .setAlpha(0.75)
      .setScale(0.1);
    this.scene.tweens.add({
      targets: ring,
      scale: (radius * 2) / 128,
      alpha: 0,
      duration: 500,
      ease: 'Cubic.easeOut',
      onComplete: () => ring.destroy(),
    });
  }

  /** Soft glow flash + burst — kiln splash landing. */
  explosion(x: number, y: number, radius: number, tint = 0xff8b4b): void {
    const ring = this.scene.add
      .image(x, y, 'glow')
      .setTint(tint)
      .setAlpha(0.9)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(38);
    this.scene.tweens.add({
      targets: ring,
      scale: radius / 40,
      alpha: 0,
      duration: 300,
      onComplete: () => ring.destroy(),
    });
    this.burst('amber', 12, x, y);
  }

  /** Rising fading text (bounties, bonuses, rune notes). */
  floatText(text: string, color: string, x: number, y: number, size = 17): void {
    const t = this.scene.add
      .text(x, y, text, { fontFamily: FONT, fontSize: `${size}px`, color, fontStyle: 'bold' })
      .setResolution(2)
      .setOrigin(0.5)
      .setDepth(45);
    this.scene.tweens.add({
      targets: t,
      y: y - 46,
      alpha: 0,
      duration: 800,
      ease: 'Cubic.easeOut',
      onComplete: () => t.destroy(),
    });
  }

  /** The lantern drinks a leaked murk: shrink+fade, then destroy. */
  absorb(sprite: Phaser.GameObjects.Image): void {
    this.scene.tweens.add({
      targets: sprite,
      scale: 0.04,
      alpha: 0,
      duration: 260,
      ease: 'Cubic.easeIn',
      onComplete: () => sprite.destroy(),
    });
  }
}

// re-export palette bits used by callers choosing colours
export const FX_KILN = 0xff8b4b;
export const FX_HALO = 0x9b8cff;
export const FX_AMBER = C.amber;
export const FX_TEXT_AMBER = CSS.amber;
