// Hud — every persistent interface element as a dumb view: top bar (wave /
// gold / lantern HP / pause), boss bars, start + speed buttons, and the
// bottom wave strip. Owns no game state; GameScene feeds it data and keeps
// the authoritative state (phase, waveStripMode, gold, hp…).
import Phaser from 'phaser';
import { C, CSS, FONT } from '../theme';
import { EnemyKind, GAME_W } from '../config';
import { PillButton } from '../ui/Button';
import { t, tN } from '../i18n';

const STRIP_PREP_Y = 1105;
const STRIP_WAVE_Y = 1188;

export interface StripChip {
  kind: EnemyKind;
  count: number;
}

export interface HudCallbacks {
  onStart(): void;
  onSpeedToggle(): void;
  onPause(): void;
}

export class Hud {
  readonly bossBar: Phaser.GameObjects.Graphics;
  private bossLabel: Phaser.GameObjects.Text;
  private goldDot: Phaser.GameObjects.Image;
  private waveText: Phaser.GameObjects.Text;
  private goldText: Phaser.GameObjects.Text;
  private hpBar: Phaser.GameObjects.Graphics;
  private startBtn: PillButton;
  private speedBtn: PillButton;

  // wave strip
  private strip?: Phaser.GameObjects.Container;
  private stripHeader?: Phaser.GameObjects.Text;
  private stripBossTag?: Phaser.GameObjects.Text;
  private stripChips: { kind: EnemyKind; icon: Phaser.GameObjects.Image; count: Phaser.GameObjects.Text }[] = [];
  private stripWave = -1;

  constructor(private scene: Phaser.Scene, cb: HudCallbacks) {
    const pad = 24; // inset from edges (iOS edge-gesture guard, research D8)
    this.waveText = scene.add
      .text(pad, 36, '', { fontFamily: FONT, fontSize: '22px', color: CSS.white, fontStyle: 'bold' })
      .setResolution(2)
      .setOrigin(0, 0.5)
      .setDepth(50);

    this.goldDot = scene.add.image(GAME_W - 148, 36, 'dot').setTint(C.amber).setScale(0.32).setDepth(50);
    this.goldText = scene.add
      .text(GAME_W - 24, 36, '', { fontFamily: FONT, fontSize: '22px', color: CSS.amber, fontStyle: 'bold' })
      .setResolution(2)
      .setOrigin(1, 0.5) // right-anchored: dot+number hug the margin at any digit count
      .setDepth(50);

    this.hpBar = scene.add.graphics().setDepth(50);
    this.bossBar = scene.add.graphics().setDepth(50).setVisible(false);

    // pause button
    const pauseG = scene.add.graphics().setDepth(50);
    pauseG.fillStyle(C.card2, 1);
    pauseG.fillRoundedRect(GAME_W - 66, 68, 48, 48, 12);
    pauseG.lineStyle(2, C.line, 1);
    pauseG.strokeRoundedRect(GAME_W - 66, 68, 48, 48, 12);
    pauseG.fillStyle(C.muted, 1);
    pauseG.fillRoundedRect(GAME_W - 52, 82, 6, 20, 3);
    pauseG.fillRoundedRect(GAME_W - 40, 82, 6, 20, 3);
    scene.add
      .zone(GAME_W - 42, 92, 48, 48)
      .setInteractive({ useHandCursor: true })
      .setDepth(51)
      .on('pointerup', cb.onPause);

    // boss bar caption (always present, shown with the bars)
    this.bossLabel = scene.add
      .text(GAME_W / 2 - 216, 125, t('boss'), { fontFamily: FONT, fontSize: '13px', color: CSS.red, fontStyle: 'bold' })
      .setResolution(2)
      .setOrigin(1, 0.5)
      .setDepth(50)
      .setVisible(false);

    this.startBtn = new PillButton(scene, {
      x: GAME_W / 2, y: 1188, w: 360, h: 64,
      label: '', fontSize: 21,
      onClick: cb.onStart,
    });
    this.speedBtn = new PillButton(scene, {
      x: GAME_W - 74, y: 1188, w: 96, h: 64,
      label: '×1', color: C.card2, textColor: CSS.white, fontSize: 21,
      onClick: cb.onSpeedToggle,
    });
  }

  // ---------- top bar ----------
  refreshTop(waveLabel: string, gold: number, hp: number, maxHp: number): void {
    this.waveText.setText(waveLabel);
    this.goldText.setText(`${gold}`);
    // keep the coin dot glued to the left edge of the right-anchored number
    this.goldDot.x = GAME_W - 24 - this.goldText.width - 14;

    this.hpBar.clear();
    const w = 300;
    const frac = Phaser.Math.Clamp(hp / maxHp, 0, 1);
    this.hpBar.fillStyle(0x0d1226, 1);
    this.hpBar.fillRoundedRect(24, 66, w, 18, 9);
    this.hpBar.fillStyle(frac > 0.5 ? C.green : frac > 0.25 ? C.amber : C.red, 1);
    this.hpBar.fillRoundedRect(24, 66, Math.max(18, w * frac), 18, 9);
    this.hpBar.lineStyle(2, C.line, 1);
    this.hpBar.strokeRoundedRect(24, 66, w, 18, 9);
    this.hpBar.fillStyle(0xeef2ff, 0.9);
    this.hpBar.fillCircle(24 + 9 + 20, 75, 3);
  }

  /** Up to two boss bars, stacked — track colour must stay visible on bg. */
  refreshBosses(bosses: { hp: number; maxHp: number }[]): void {
    const top = bosses.slice(0, 2);
    if (top.length === 0) {
      this.bossBar.setVisible(false);
      this.bossLabel.setVisible(false);
      return;
    }
    this.bossBar.setVisible(true).clear();
    this.bossLabel.setVisible(true);
    const bw = 420;
    top.forEach((boss, i) => {
      const by = 116 + i * 28;
      const f = Phaser.Math.Clamp(boss.hp / boss.maxHp, 0, 1);
      this.bossBar.fillStyle(C.card2, 1);
      this.bossBar.fillRoundedRect(GAME_W / 2 - bw / 2, by, bw, 18, 9);
      this.bossBar.fillStyle(C.red, 1);
      this.bossBar.fillRoundedRect(GAME_W / 2 - bw / 2, by, Math.max(18, bw * f), 18, 9);
      this.bossBar.lineStyle(2, C.line, 1);
      this.bossBar.strokeRoundedRect(GAME_W / 2 - bw / 2, by, bw, 18, 9);
    });
  }

  // ---------- bottom buttons ----------
  /** Start button visible only during prep; label with wave number. */
  setStartState(visible: boolean, label: string): void {
    this.startBtn.container.setVisible(visible);
    if (visible) this.startBtn.setEnabled(true).setLabel(label);
  }

  setSpeedLabel(label: string): void {
    this.speedBtn.setLabel(label);
  }

  // ---------- wave strip ----------
  get stripVisible(): boolean {
    return this.strip?.visible ?? false;
  }

  stripHide(): void {
    this.strip?.setVisible(false);
  }

  /** Show the strip: 'next' = upcoming composition, 'remaining' = live tracker. */
  stripShow(waveIndex: number, chips: StripChip[], mode: 'next' | 'remaining', prep: boolean): void {
    if (!this.strip) {
      const c = this.scene.add
        .container(360, prep ? STRIP_PREP_Y : STRIP_WAVE_Y)
        .setDepth(52)
        .setAlpha(0);
      const bg = this.scene.add.graphics();
      bg.fillStyle(C.card, 0.92);
      bg.fillRoundedRect(-234, -32, 468, 64, 14);
      bg.lineStyle(2, C.line, 1);
      bg.strokeRoundedRect(-234, -32, 468, 64, 14);
      c.add(bg);
      this.stripHeader = this.scene.add
        .text(-214, -16, '', { fontFamily: FONT, fontSize: '17px', color: CSS.amber, fontStyle: 'bold' })
        .setResolution(2)
        .setOrigin(0, 0.5);
      this.stripBossTag = this.scene.add
        .text(214, -16, t('boss'), { fontFamily: FONT, fontSize: '17px', color: CSS.red, fontStyle: 'bold' })
        .setResolution(2)
        .setOrigin(1, 0.5)
        .setVisible(false);
      c.add([this.stripHeader, this.stripBossTag]);
      this.strip = c;
    }

    const c = this.strip;
    c.setVisible(true);

    if (this.stripWave !== waveIndex) {
      this.stripWave = waveIndex;
      for (const ch of this.stripChips) {
        ch.icon.destroy();
        ch.count.destroy();
      }
      this.stripChips = [];
      const n = chips.length;
      const chipW = Math.min(115, 428 / n);
      const compact = chipW < 100;
      const rowW = chipW * n;
      chips.forEach(({ kind }, i) => {
        // chip row centred in the strip (was packed from the left edge)
        const cx = -rowW / 2 + chipW * (i + 0.5);
        const base = kind === 'boss' ? 0.31 : kind === 'swarm' ? 0.18 : 0.24;
        const scale = compact ? base * 0.85 : base;
        const icon = this.scene.add.image(cx - (compact ? 17 : 21), 12, `enemy_${kind}`).setScale(scale);
        const count = this.scene.add
          .text(cx - (compact ? 1 : 3), 12, '', {
            fontFamily: FONT,
            fontSize: compact ? '18px' : '19px',
            color: CSS.white,
            fontStyle: 'bold',
          })
          .setResolution(2)
          .setOrigin(0, 0.5);
        c.add([icon, count]);
        this.stripChips.push({ kind, icon, count });
      });
      this.stripBossTag?.setVisible(chips.some((m) => m.kind === 'boss'));
    }

    if (mode === 'next') {
      this.stripHeader?.setText(tN('stripNext', waveIndex)).setColor(CSS.amber);
      this.stripCounts(new Map(chips.map((m) => [m.kind, m.count])));
    } else {
      this.stripHeader?.setText(tN('stripRemaining', waveIndex)).setColor(CSS.white);
    }

    const targetY = prep ? STRIP_PREP_Y : STRIP_WAVE_Y;
    if (Math.abs(c.y - targetY) > 1) {
      this.scene.tweens.add({ targets: c, y: targetY, duration: 240, ease: 'Cubic.easeOut' });
    }
    if (c.alpha < 1) this.scene.tweens.add({ targets: c, alpha: 1, duration: 200 });
  }

  /** Live per-kind counts (alive + queued). */
  stripCounts(counts: Map<EnemyKind, number>): void {
    for (const ch of this.stripChips) {
      const n = counts.get(ch.kind) ?? 0;
      ch.count.setText(`×${n}`);
      const dim = n === 0 ? 0.35 : 1;
      ch.icon.setAlpha(dim);
      ch.count.setAlpha(dim);
    }
  }

  /** Full teardown (scene restart wipes game objects; this clears our refs). */
  destroy(): void {
    this.strip = undefined;
    this.stripChips = [];
    this.stripWave = -1;
  }
}
