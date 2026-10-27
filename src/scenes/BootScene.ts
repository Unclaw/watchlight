// BootScene — every visual asset is generated procedurally at boot
// ("flat vector glow": dark cores, luminous 2px-stroke edges, baked glow).
// Textures render at 2× logical size and are displayed at 0.5 scale so the
// game stays crisp on 3× Retina screens while never exceeding tiny GPU budgets.
import Phaser from 'phaser';
import { C, TOWER_COLOR, ENEMY_COLOR } from '../theme';

const S = 2; // supersample factor

function glowRings(g: Phaser.GameObjects.Graphics, r: number, color: number, rings = 4): void {
  for (let i = rings; i >= 1; i--) {
    g.fillStyle(color, 0.05 * (rings - i + 1) / rings + 0.03);
    g.fillCircle(r, r, (r * i) / rings);
  }
}

function polyPath(g: Phaser.GameObjects.Graphics, pts: { x: number; y: number }[]): void {
  g.beginPath();
  g.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
  g.closePath();
}

function regularPoly(cx: number, cy: number, r: number, n: number, rot = 0): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i < n; i++) {
    const a = rot + (i / n) * Math.PI * 2;
    pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
  }
  return pts;
}

/** Murk enemy: dark core, emissive edge, soft glow — shape = identity. */
function enemyTexture(scene: Phaser.Scene, kind: string, color: number): void {
  const size = kind === 'boss' ? 150 : kind === 'swarm' ? 46 : 74;
  const s = size * S;
  const g = scene.add.graphics();
  const c = s / 2;
  const r = (s / 2) * 0.72;
  glowRings(g, s / 2, color, 4);
  const stroke = () => g.lineStyle(4 * S, color, 1);
  const coreFill = () => g.fillStyle(0x0d1226, 1);

  switch (kind) {
    case 'runner': {
      const pts = [{ x: c, y: c - r }, { x: c + r * 0.95, y: c + r * 0.8 }, { x: c - r * 0.95, y: c + r * 0.8 }];
      coreFill(); polyPath(g, pts); g.fillPath();
      stroke(); polyPath(g, pts); g.strokePath();
      g.fillStyle(color, 0.9); g.fillCircle(c, c + r * 0.15, r * 0.22);
      break;
    }
    case 'swarm': {
      coreFill(); g.fillCircle(c, c, r);
      stroke(); g.strokeCircle(c, c, r);
      g.fillStyle(color, 0.9); g.fillCircle(c, c, r * 0.3);
      break;
    }
    case 'shielded': {
      const pts = regularPoly(c, c, r, 5, -Math.PI / 2);
      coreFill(); polyPath(g, pts); g.fillPath();
      stroke(); polyPath(g, pts); g.strokePath();
      g.lineStyle(2 * S, color, 0.45); g.strokeCircle(c, c, r * 1.25); // shield ring
      break;
    }
    case 'flyer': {
      // chevron pointing at the lantern (downward)
      const pts = [{ x: c, y: c + r }, { x: c + r, y: c - r * 0.6 }, { x: c, y: c + r * 0.05 }, { x: c - r, y: c - r * 0.6 }];
      coreFill(); polyPath(g, pts); g.fillPath();
      stroke(); polyPath(g, pts); g.strokePath();
      break;
    }
    case 'healer': {
      const pts = regularPoly(c, c, r, 6, Math.PI / 6);
      coreFill(); polyPath(g, pts); g.fillPath();
      stroke(); polyPath(g, pts); g.strokePath();
      // plus-mark core
      const w = r * 0.2, l = r * 0.55;
      g.fillStyle(color, 0.9);
      g.fillRect(c - w / 2, c - l, w, l * 2);
      g.fillRect(c - l, c - w / 2, l * 2, w);
      break;
    }
    case 'boss': {
      const pts = regularPoly(c, c, r, 8, Math.PI / 8);
      glowRings(g, s / 2, color, 5);
      coreFill(); polyPath(g, pts); g.fillPath();
      g.lineStyle(6 * S, color, 1); polyPath(g, pts); g.strokePath();
      const inner = regularPoly(c, c, r * 0.55, 8, Math.PI / 8);
      g.lineStyle(3 * S, color, 0.5); polyPath(g, inner); g.strokePath();
      g.fillStyle(0xffffff, 0.85); g.fillCircle(c, c, r * 0.16);
      break;
    }
  }
  g.generateTexture(`enemy_${kind}`, s, s);
  g.destroy();
}

/** Tower: rounded-square plinth + glyph, baked in tower accent colour. */
function towerTexture(scene: Phaser.Scene, kind: string): void {
  const size = 76;
  const s = size * S;
  const g = scene.add.graphics();
  const color = TOWER_COLOR[kind];
  const c = s / 2;
  const half = (s / 2) * 0.78;
  const rr = 14 * S;

  glowRings(g, s / 2, color, 3);
  g.fillStyle(0x131a30, 1);
  g.fillRoundedRect(c - half, c - half, half * 2, half * 2, rr);
  g.lineStyle(3 * S, color, 0.95);
  g.strokeRoundedRect(c - half, c - half, half * 2, half * 2, rr);
  g.lineStyle(1.5 * S, color, 0.25);
  g.strokeRoundedRect(c - half + 6 * S, c - half + 6 * S, half * 2 - 12 * S, half * 2 - 12 * S, rr * 0.8);

  const r = half * 0.42;
  switch (kind) {
    case 'ember': {
      // upward spark triangle
      const pts = [{ x: c, y: c - r }, { x: c + r * 0.8, y: c + r * 0.7 }, { x: c - r * 0.8, y: c + r * 0.7 }];
      g.fillStyle(color, 0.9); polyPath(g, pts); g.fillPath();
      g.fillStyle(0xffffff, 0.95); g.fillCircle(c, c + r * 0.25, r * 0.2);
      break;
    }
    case 'prism': {
      g.fillStyle(color, 0.9);
      g.fillRoundedRect(c - r * 0.35, c - r * 1.25, r * 0.7, r * 2.5, r * 0.35);
      g.fillStyle(0xffffff, 0.9);
      g.fillCircle(c, c, r * 0.28);
      break;
    }
    case 'halo': {
      g.lineStyle(4 * S, color, 0.95);
      g.strokeCircle(c, c, r * 1.05);
      g.fillStyle(0xffffff, 0.9);
      g.fillCircle(c, c, r * 0.3);
      break;
    }
    case 'kiln': {
      g.fillStyle(color, 0.9);
      g.fillRoundedRect(c - r * 0.85, c - r * 0.85, r * 1.7, r * 1.7, r * 0.35);
      g.fillStyle(0xffffff, 0.95);
      g.fillCircle(c, c, r * 0.35);
      break;
    }
  }
  g.generateTexture(`tower_${kind}`, s, s);
  g.destroy();
}

export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  create(): void {
    const g = this.add.graphics();

    // soft white radial glow (tintable) — 2 sizes cover all uses
    for (const [key, size] of [['glow', 128], ['glow_s', 48]] as const) {
      const s = size * S;
      const gg = this.add.graphics();
      glowRings(gg, s / 2, 0xffffff, 6);
      gg.fillStyle(0xffffff, 1);
      gg.fillCircle(s / 2, s / 2, (s / 2) * 0.18);
      gg.generateTexture(key, s, s);
      gg.destroy();
    }

    // tintable white dot (bullets, particles) + diamond spark
    {
      const s = 24 * S;
      const gd = this.add.graphics();
      gd.fillStyle(0xffffff, 1); gd.fillCircle(s / 2, s / 2, s / 2 * 0.9);
      gd.generateTexture('dot', s, s); gd.destroy();
    }
    {
      const s = 36 * S;
      const gd = this.add.graphics();
      const c = s / 2, r = s / 2 * 0.8;
      gd.fillStyle(0xffffff, 1);
      polyPath(gd, [{ x: c, y: c - r }, { x: c + r * 0.6, y: c }, { x: c, y: c + r }, { x: c - r * 0.6, y: c }]);
      gd.fillPath();
      gd.generateTexture('spark', s, s); gd.destroy();
    }

    // prism beam: rounded capsule, alpha handled by tween
    {
      const w = 560, h = 18;
      const bc = this.add.graphics();
      bc.fillStyle(0xffffff, 1);
      bc.fillRoundedRect(0, 0, w * S, h * S, h * S / 2);
      bc.generateTexture('beam', w * S, h * S);
      bc.destroy();
    }

    // upgrade-available chevron (tintable white, gentle glow underlay)
    {
      const s = 28 * S;
      const gu = this.add.graphics();
      const c = s / 2;
      const w = s * 0.3;
      glowRings(gu, s / 2, 0xffffff, 2);
      gu.lineStyle(5 * S, 0xffffff, 1);
      gu.beginPath();
      gu.moveTo(c - w, c + w * 0.55);
      gu.lineTo(c, c - w * 0.45);
      gu.lineTo(c + w, c + w * 0.55);
      gu.strokePath();
      gu.generateTexture('up_arrow', s, s);
      gu.destroy();
    }

    // crisp stroked ring (shockwaves, aura pulses) — tintable white
    {
      const s = 128 * S;
      const gr = this.add.graphics();
      const c = s / 2;
      const r = s * 0.42;
      gr.lineStyle(10 * S, 0xffffff, 0.22);
      gr.strokeCircle(c, c, r);
      gr.lineStyle(4 * S, 0xffffff, 1);
      gr.strokeCircle(c, c, r);
      gr.generateTexture('ring', s, s);
      gr.destroy();
    }

    // build tile (empty / hover)
    for (const [key, strokeA] of [['tile', 0.35], ['tile_hover', 0.9]] as const) {
      const s = 64 * S;
      const gt = this.add.graphics();
      gt.fillStyle(0x101830, 0.85);
      gt.fillRoundedRect(0, 0, s, s, 12 * S);
      gt.lineStyle(2 * S, C.muted, strokeA);
      gt.strokeRoundedRect(0, 0, s, s, 12 * S);
      gt.fillStyle(C.muted, strokeA * 0.8);
      gt.fillCircle(s / 2, s / 2, 3.5 * S);
      gt.generateTexture(key, s, s);
      gt.destroy();
    }

    // lantern: the one big sprite — white-hot diamond in an amber ring
    {
      const s = 200 * S;
      const gl = this.add.graphics();
      const c = s / 2;
      glowRings(gl, s / 2, C.amber, 6);
      gl.lineStyle(5 * S, C.amber, 1);
      gl.strokeCircle(c, c, s * 0.19);
      const r = s * 0.13;
      gl.fillStyle(C.amber, 1);
      polyPath(gl, [{ x: c, y: c - r }, { x: c + r, y: c }, { x: c, y: c + r }, { x: c - r, y: c }]);
      gl.fillPath();
      gl.fillStyle(0xfff4d6, 1);
      polyPath(gl, [{ x: c, y: c - r * 0.5 }, { x: c + r * 0.5, y: c }, { x: c, y: c + r * 0.5 }, { x: c - r * 0.5, y: c }]);
      gl.fillPath();
      gl.generateTexture('lantern', s, s);
      gl.destroy();
    }

    // enemies + towers
    for (const kind of Object.keys(ENEMY_COLOR)) enemyTexture(this, kind, ENEMY_COLOR[kind]);
    for (const kind of Object.keys(TOWER_COLOR)) towerTexture(this, kind);

    g.destroy();
    this.scene.start('Menu');
  }
}
