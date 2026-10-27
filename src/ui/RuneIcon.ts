// RuneIcon — one renderer for rune glyphs everywhere (pick overlay + shelf).
// Style: small dark disc + accent ring; tower runes use the tower texture,
// the rest use the geometric glyph set drawn parametrically.
import Phaser from 'phaser';
import { RuneDef } from '../config';

const TOWER_GLYPHS = ['ember', 'prism', 'halo', 'kiln'];

export function drawRuneGlyph(
  g: Phaser.GameObjects.Graphics,
  glyph: string,
  cx: number,
  cy: number,
  s: number,
  color: number,
  lw: number,
): void {
  g.lineStyle(lw, color, 1);
  g.fillStyle(color, 0.95);
  switch (glyph) {
    case 'bolt':
      g.beginPath();
      g.moveTo(cx + s * 0.23, cy - s);
      g.lineTo(cx - s * 0.46, cy + s * 0.15);
      g.lineTo(cx + s * 0.08, cy + s * 0.15);
      g.lineTo(cx - s * 0.23, cy + s);
      g.lineTo(cx + s * 0.54, cy - s * 0.23);
      g.lineTo(cx, cy - s * 0.23);
      g.closePath();
      g.fillPath();
      break;
    case 'heart':
      g.fillCircle(cx - s * 0.42, cy - s * 0.31, s * 0.5);
      g.fillCircle(cx + s * 0.42, cy - s * 0.31, s * 0.5);
      g.beginPath();
      g.moveTo(cx - s * 0.85, cy - s * 0.12);
      g.lineTo(cx, cy + s);
      g.lineTo(cx + s * 0.85, cy - s * 0.12);
      g.closePath();
      g.fillPath();
      break;
    case 'coinStack': // three stacked coin capsules — a pile of gold
      {
        const w = s * 0.85;
        const h = s * 0.5;
        g.fillStyle(color, 0.22);
        g.fillRoundedRect(cx - w * 0.36, cy - s, w * 0.72, h, h / 2);
        g.strokeRoundedRect(cx - w * 0.36, cy - s, w * 0.72, h, h / 2);
        g.fillRoundedRect(cx - w / 2, cy - s * 0.38, w, h, h / 2);
        g.strokeRoundedRect(cx - w / 2, cy - s * 0.38, w, h, h / 2);
        g.fillRoundedRect(cx - w / 2, cy + s * 0.24, w, h, h / 2);
        g.strokeRoundedRect(cx - w / 2, cy + s * 0.24, w, h, h / 2);
      }
      break;
    case 'sparkle': // 4-point star, same motif as the ember spark texture
      {
        const w = s * 0.34;
        g.fillStyle(color, 0.35);
        g.beginPath();
        g.moveTo(cx - s, cy); g.lineTo(cx, cy - w * 0.5);
        g.lineTo(cx + s, cy); g.lineTo(cx, cy + w * 0.5);
        g.closePath();
        g.fillPath();
        g.fillStyle(color, 0.95);
        g.beginPath();
        g.moveTo(cx, cy - s); g.lineTo(cx + w, cy);
        g.lineTo(cx, cy + s); g.lineTo(cx - w, cy);
        g.closePath();
        g.fillPath();
      }
      break;
    case 'hand': // stylised: three pillars on a base
      g.fillRoundedRect(cx - s * 0.77, cy - s, s * 0.35, s * 1.31, s * 0.15);
      g.fillRoundedRect(cx - s * 0.15, cy - s * 1.23, s * 0.35, s * 1.54, s * 0.15);
      g.fillRoundedRect(cx + s * 0.46, cy - s, s * 0.35, s * 1.31, s * 0.15);
      g.fillRoundedRect(cx - s * 0.92, cy + s * 0.46, s * 1.85, s * 0.38, s * 0.19);
      break;
    case 'eye':
      g.strokeEllipse(cx, cy, s * 2, s * 1.15);
      g.fillCircle(cx, cy, s * 0.35);
      break;
    case 'snow':
      for (let i = 0; i < 3; i++) {
        const a = (i * Math.PI) / 3;
        g.beginPath();
        g.moveTo(cx - Math.cos(a) * s, cy - Math.sin(a) * s);
        g.lineTo(cx + Math.cos(a) * s, cy + Math.sin(a) * s);
        g.strokePath();
      }
      g.fillCircle(cx, cy, s * 0.23);
      break;
  }
}

/** Disc + glyph icon for a rune. `size` = disc radius in px; `withDisc`
 * false renders the bare glyph (for hosts that draw their own disc). */
export function makeRuneIcon(scene: Phaser.Scene, rune: RuneDef, size = 26, withDisc = true): Phaser.GameObjects.Container {
  const c = scene.add.container(0, 0);
  if (withDisc) {
    const disc = scene.add.graphics();
    disc.fillStyle(0x0d1226, 1);
    disc.fillCircle(0, 0, size);
    disc.lineStyle(Math.max(1.5, size * 0.08), rune.accent, 0.85);
    disc.strokeCircle(0, 0, size);
    c.add(disc);
  }

  if (TOWER_GLYPHS.includes(rune.glyph)) {
    // tower textures display 152px at scale 1 → glyph ≈ size*1.5 tall
    const img = scene.add.image(0, 0, `tower_${rune.glyph}`).setScale(size / 100);
    c.add(img);
  } else {
    const glyph = scene.add.graphics();
    drawRuneGlyph(glyph, rune.glyph, 0, 0, size * 0.72, rune.accent, Math.max(1.5, size * 0.14));
    c.add(glyph);
  }
  return c;
}
