// Bottom build sheet — one-thumb tower placement & upgrades.
// Tap a tile → sheet slides up → tap a tower card to build. No dragging.
import Phaser from 'phaser';
import { C, CSS, FONT } from '../theme';
import { TowerKind } from '../config';
import { audio } from '../audio';
import { t, tN, towerBlurb, towerName } from '../i18n';
import type { GameScene } from '../scenes/GameScene';
import type { Tower } from '../entities/Tower';

const SHEET_H = 320;

export class BuildSheet {
  private scene: GameScene;
  private root: Phaser.GameObjects.Container;
  private content: Phaser.GameObjects.Container;
  private dim: Phaser.GameObjects.Rectangle;
  private open = false;
  private mode: 'build' | 'tower' | null = null;
  private tileIndex = -1;
  private buildCards: {
    kind: TowerKind;
    cost: number;
    x: number;
    y: number;
    card: Phaser.GameObjects.Graphics;
    costT: Phaser.GameObjects.Text;
  }[] = [];
  private upg: { card: Phaser.GameObjects.Graphics; label: Phaser.GameObjects.Text; y: number } | null = null;
  private sellLabel: Phaser.GameObjects.Text | null = null;

  constructor(scene: GameScene) {
    this.scene = scene;
    const { width, height } = scene.scale;
    this.root = scene.add.container(0, 0).setDepth(60).setVisible(false);
    this.dim = scene.add.rectangle(width / 2, height / 2, width, height, 0x05070f, 0.6).setInteractive();
    this.dim.on('pointerup', () => this.close());
    this.root.add(this.dim);
    this.content = scene.add.container(0, height + SHEET_H);
    this.root.add(this.content);

    const bg = scene.add.graphics();
    bg.fillStyle(C.card, 1);
    bg.fillRoundedRect(20, height - SHEET_H, width - 40, SHEET_H + 60, 26);
    bg.lineStyle(2, C.line, 1);
    bg.strokeRoundedRect(20, height - SHEET_H, width - 40, SHEET_H + 60, 26);
    this.content.add(bg);
  }

  isOpen(): boolean {
    return this.open;
  }

  private slide(open: boolean): void {
    const { height } = this.scene.scale;
    this.open = open;
    this.root.setVisible(true);
    this.scene.tweens.add({
      targets: this.content,
      y: open ? 0 : height + SHEET_H,
      duration: 220,
      ease: open ? 'Cubic.easeOut' : 'Cubic.easeIn',
      onComplete: () => {
        if (!open) this.root.setVisible(false);
      },
    });
  }

  close(): void {
    if (this.open) {
      this.mode = null;
      this.buildCards = [];
      this.upg = null;
      this.slide(false);
      this.scene.selectTile(-1);
    }
  }

  /** Live affordability update — driven by GameScene's 150ms HUD pass so
   * gold earned mid-wave lights up cards/buttons without reopening the
   * sheet. Restyles in place (no rebuild) so an in-progress tap is never lost. */
  refresh(): void {
    if (!this.open) return;
    if (this.mode === 'build') {
      for (const bc of this.buildCards) {
        const afford = this.scene.gold >= bc.cost;
        this.drawBuildCard(bc.card, bc.x, bc.y, afford);
        bc.costT.setColor(afford ? CSS.amber : '#ff6b7a');
      }
    } else if (this.mode === 'tower') {
      const tower = this.scene.towerAt(this.tileIndex);
      if (!tower) {
        this.close();
        return;
      }
      this.drawUpgradeButton(tower);
      this.sellLabel?.setText(this.sellText(tower));
    }
  }

  /** Kinds the player can currently afford (used by the e2e smoke). */
  affordableKinds(): TowerKind[] {
    return this.buildCards.filter((bc) => this.scene.gold >= bc.cost).map((bc) => bc.kind);
  }

  private drawBuildCard(card: Phaser.GameObjects.Graphics, x: number, y: number, afford: boolean): void {
    card.clear();
    card.fillStyle(C.card2, 1);
    card.fillRoundedRect(x - 130, y - 52, 260, 108, 18);
    card.lineStyle(2, afford ? C.amber : C.line, afford ? 0.9 : 0.5);
    card.strokeRoundedRect(x - 130, y - 52, 260, 108, 18);
  }

  private sellText(tower: Tower): string {
    const pct = Math.round(tower.sellRate * 100);
    return `${t('sell')}  ·  ${tower.sellValue} ${t('goldUnit')}${pct < 100 ? ` (${pct}%)` : ` ${t('sellFull')}`}`;
  }

  private drawUpgradeButton(tower: Tower): void {
    if (!this.upg) return;
    const cost = tower.nextCost();
    const canUp = cost !== null && this.scene.gold >= cost;
    this.upg.card.clear();
    this.upg.card.fillStyle(canUp ? C.amber : 0x2a3a63, 1);
    this.upg.card.fillRoundedRect(65, this.upg.y - 28, 330, 56, 28);
    this.upg.label.setText(cost === null ? t('maxTier') : `${t('upgrade')}  ·  ${cost} ${t('goldUnit')}`);
    this.upg.label.setColor(canUp ? '#101830' : CSS.muted);
  }

  /** Sheet for an empty tile: 4 tower cards in a 2×2 grid. */
  showBuild(tileIndex: number): void {
    this.content.removeAll(true);
    this.mode = 'build';
    this.tileIndex = tileIndex;
    this.buildCards = [];
    this.upg = null;
    this.sellLabel = null;
    const { width, height } = this.scene.scale;
    // header chip: bright label on its own pill so it reads against the sheet
    const titleY = height - SHEET_H + 36;
    const chipW = 216, chipH = 36;
    const chip = this.scene.add.graphics();
    chip.fillStyle(C.bg2, 1);
    chip.fillRoundedRect(width / 2 - chipW / 2, titleY - chipH / 2, chipW, chipH, 14);
    chip.lineStyle(2, C.line, 1);
    chip.strokeRoundedRect(width / 2 - chipW / 2, titleY - chipH / 2, chipW, chipH, 14);
    this.content.add(chip);
    this.content.add(
      this.scene.add
        .text(width / 2, titleY, t('raiseTower'), {
          fontFamily: FONT, fontSize: '17px', color: CSS.amber, fontStyle: 'bold',
        })
        .setResolution(2).setOrigin(0.5),
    );

    // level gates which towers are buildable (progressive unlock)
    const allKinds: TowerKind[] = ['ember', 'prism', 'halo', 'kiln'];
    const kinds = allKinds.filter((k) => this.scene.level.towers.includes(k));
    kinds.forEach((kind, i) => {
      const row = Math.floor(i / 2);
      // standard grid: columns centred at 204 / 516 → the PAIR is centred on
      // the viewport (old 184/496 centred at 340). An odd count's LAST card
      // centres on screen instead of hugging the left.
      const orphan = kinds.length % 2 === 1 && i === kinds.length - 1;
      const x = orphan ? width / 2 : 74 + (i % 2) * 312 + 130;
      const y = height - SHEET_H + 116 + row * 122;
      const cost = this.scene.buildCost(kind);

      const card = this.scene.add.graphics();
      const afford = this.scene.gold >= cost;
      this.drawBuildCard(card, x, y, afford);

      const icon = this.scene.add.image(x - 88, y, `tower_${kind}`).setScale(0.3);
      // tier pips (matches the tower panel's language): three small dots
      for (let t = 0; t < 3; t++) {
        this.scene.add
          .image(x + 88 + (t - 1) * 14, y - 34, 'dot')
          .setTint(t === 0 ? C.amber : 0x2a3a63)
          .setScale(t === 0 ? 0.16 : 0.1)
          .setAlpha(t === 0 ? 0.95 : 0.55);
      }
      const name = this.scene.add
        .text(x - 38, y - 30, towerName(kind), { fontFamily: FONT, fontSize: '20px', color: CSS.white, fontStyle: 'bold' })
        .setResolution(2).setOrigin(0, 0.5);
      const blurb = this.scene.add
        .text(x - 38, y - 2, towerBlurb(kind), { fontFamily: FONT, fontSize: '14px', color: CSS.muted })
        .setResolution(2).setOrigin(0, 0.5);
      const costT = this.scene.add
        .text(x - 38, y + 26, `${cost} ${t('goldUnit')}`, {
          fontFamily: FONT, fontSize: '18px', color: afford ? CSS.amber : '#ff6b7a', fontStyle: 'bold',
        })
        .setResolution(2).setOrigin(0, 0.5);

      const zone = this.scene.add.zone(x, y, 260, 108).setInteractive({ useHandCursor: true });
      zone.on('pointerup', () => {
        if (this.scene.gold < cost) {
          audio.play('deny');
          return;
        }
        this.scene.buildTower(tileIndex, kind);
        this.close();
      });

      this.content.add([card, icon, name, blurb, costT, zone]);
      this.buildCards.push({ kind, cost, x, y, card, costT });
    });
    this.slide(true);
  }

  /** Sheet for an existing tower: stats + upgrade/sell. */
  showTower(tileIndex: number): void {
    const tower = this.scene.towerAt(tileIndex);
    if (!tower) return;
    this.content.removeAll(true);
    this.mode = 'tower';
    this.tileIndex = tileIndex;
    this.buildCards = [];
    this.upg = null;
    this.sellLabel = null;
    const { height } = this.scene.scale;
    const def = tower.def;

    const icon = this.scene.add.image(77, height - SHEET_H + 52, `tower_${tower.kind}`).setScale(0.32);
    const name = this.scene.add
      .text(121, height - SHEET_H + 34, `${towerName(tower.kind)}  ·  ${tN('tier', tower.tier + 1)}`, {
        fontFamily: FONT, fontSize: '22px', color: CSS.white, fontStyle: 'bold',
      })
      .setResolution(2).setOrigin(0, 0.5);

    const next = tower.tier < 2 ? def.tiers[tower.tier + 1] : null;
    const line = (label: string, v: string, nv: string | null, i: number) => {
      const y = height - SHEET_H + 92 + i * 30;
      this.content.add(
        this.scene.add
          .text(65, y, t(label === 'damage' ? 'statDmg' : label === 'rate' ? 'statRate' : 'statRange'), { fontFamily: FONT, fontSize: '16px', color: CSS.muted })
          .setResolution(2).setOrigin(0, 0.5),
      );
      this.content.add(
        this.scene.add
          .text(215, y, v, { fontFamily: FONT, fontSize: '16px', color: CSS.white })
          .setResolution(2).setOrigin(0, 0.5),
      );
      if (nv) {
        this.content.add(
          this.scene.add
            .text(305, y, `→ ${nv}`, { fontFamily: FONT, fontSize: '16px', color: CSS.green })
            .setResolution(2).setOrigin(0, 0.5),
        );
      }
    };
    line('damage', `${Math.round(tower.dmg)}`, next ? `${Math.round(def.tiers[tower.tier + 1].dmg)}` : null, 0);
    line('rate', `${tower.rate.toFixed(1)}/s`, next ? `${def.tiers[tower.tier + 1].rate.toFixed(1)}/s` : null, 1);
    line('range', `${Math.round(tower.range)}`, next ? `${def.tiers[tower.tier + 1].range}` : null, 2);

    // upgrade / sell — centred action row: 65..395 + 20 gap + 415..655
    const upY = height - 74;
    const up = this.scene.add.graphics();
    const upT = this.scene.add
      .text(230, upY, '', {
        fontFamily: FONT, fontSize: '19px', fontStyle: 'bold',
      })
      .setResolution(2).setOrigin(0.5);
    this.upg = { card: up, label: upT, y: upY };
    this.drawUpgradeButton(tower);
    const upZone = this.scene.add.zone(230, upY, 330, 56).setInteractive({ useHandCursor: true });
    upZone.on('pointerup', () => {
      const c = tower.nextCost();
      if (c === null || this.scene.gold < c) {
        audio.play('deny');
        return;
      }
      this.scene.upgradeTower(tower);
      this.showTower(tileIndex); // refresh
    });

    const sell = this.scene.add.graphics();
    sell.fillStyle(0x1b2745, 1);
    sell.fillRoundedRect(415, upY - 28, 240, 56, 28);
    sell.lineStyle(2, C.red, 0.6);
    sell.strokeRoundedRect(415, upY - 28, 240, 56, 28);
    const sellT = this.scene.add
      .text(535, upY, this.sellText(tower), {
        fontFamily: FONT, fontSize: '18px', color: CSS.red,
      })
      .setResolution(2).setOrigin(0.5);
    this.sellLabel = sellT;
    const sellZone = this.scene.add.zone(535, upY, 240, 56).setInteractive({ useHandCursor: true });
    sellZone.on('pointerup', () => {
      this.scene.sellTower(tower);
      this.close();
    });

    this.content.add([icon, name, up, upT, upZone, sell, sellT, sellZone]);
    this.slide(true);
  }
}
