// Shared pill button used across menus and overlays.
// Touch-friendly: ≥ 64px logical height, press feedback, audio unlock on tap.
import Phaser from 'phaser';
import { C, CSS, FONT } from '../theme';
import { audio } from '../audio';

export interface ButtonOpts {
  x: number;
  y: number;
  w: number;
  h?: number;
  label: string;
  color?: number; // accent
  textColor?: string;
  fontSize?: number;
  onClick: () => void;
}

export class PillButton {
  readonly container: Phaser.GameObjects.Container;
  private bg!: Phaser.GameObjects.Graphics;
  private text: Phaser.GameObjects.Text;
  private zone: Phaser.GameObjects.Zone;
  private enabled = true;
  private readonly w: number;
  private readonly h: number;
  private accent: number;

  constructor(scene: Phaser.Scene, opts: ButtonOpts) {
    this.w = opts.w;
    this.h = opts.h ?? 66;
    this.accent = opts.color ?? C.amber;
    this.container = scene.add.container(opts.x, opts.y);

    this.bg = scene.add.graphics();
    this.drawBg(this.accent, 1);
    this.text = scene.add
      .text(0, 0, opts.label, {
        fontFamily: FONT,
        fontSize: `${opts.fontSize ?? 22}px`,
        color: opts.textColor ?? '#101830',
        fontStyle: 'bold',
      })
      .setResolution(2)
      .setOrigin(0.5);
    this.container.add([this.bg, this.text]);

    this.zone = scene.add.zone(0, 0, this.w, this.h).setInteractive({ useHandCursor: true });
    this.container.add(this.zone);
    this.zone.on('pointerdown', () => {
      if (!this.enabled) return;
      audio.unlock();
      audio.play('tap');
      scene.tweens.add({
        targets: this.container,
        scale: { from: 0.94, to: 1 },
        duration: 140,
        ease: 'Back.easeOut',
      });
    });
    this.zone.on('pointerup', () => {
      if (!this.enabled) return;
      opts.onClick();
    });
  }

  private drawBg(color: number, a: number): void {
    const w = this.w, h = this.h, r = Math.min(h / 2, 33);
    this.bg.clear();
    this.bg.fillStyle(color, a);
    this.bg.fillRoundedRect(-w / 2, -h / 2, w, h, r);
    this.bg.lineStyle(2, 0xeef2ff, a * 0.15);
    this.bg.strokeRoundedRect(-w / 2, -h / 2, w, h, r);
  }

  setLabel(label: string): this {
    this.text.setText(label);
    return this;
  }

  setColor(color: number, textColor: string): this {
    this.accent = color;
    this.drawBg(color, 1);
    this.text.setColor(textColor);
    return this;
  }

  setEnabled(on: boolean, dimColor = 0x2a3a63): this {
    this.enabled = on;
    this.drawBg(on ? this.accent : dimColor, 1);
    this.text.setColor(on ? '#101830' : CSS.muted);
    return this;
  }

  destroy(): void {
    this.container.destroy();
  }
}
