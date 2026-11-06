// Bottom build sheet — one-thumb tower placement & upgrades.
// Tap a tile → sheet slides up → tap a tower card to build. No dragging.
import Phaser from 'phaser';
import { C, CSS, FONT } from '../theme';
import { TowerKind } from '../config';
import { audio } from '../audio';
import { t, tN, towerBlurb, towerName } from '../i18n';
import { groveGainMult } from '../runes';
import type { GameScene } from '../scenes/GameScene';
import type { Tower } from '../entities/Tower';

/** Shared sheet geometry — ONE source consumed by showBuild AND the e2e
 * scripts' click targets (M4): layout churn must never fork the test coords.
 * The scripts reach it in-page via BuildSheet.cardSlotsFor()/sheetBgBounds().
 *
 * Grid (operator spec, W4.0-4): 2 cols × up to 3 rows. From L6 the Wisp
 * Grove owns the top-left slot and top-right stays EMPTY (reserved for a
 * future tower); the rest fill rows 2-3 in roster order. Below L6 the sheet
 * shows just a 2×N grid of the unlocked kinds and grows to 3 rows at L6. */
export const SHEET_LAYOUT = {
  bgPadX: 20, // sheet bg inset from the screen edges (bg spans 20..width-20)
  cardH: 108,
  cardW: 260, // stable 2-col cards at every level
  col0: 204, // col0 centre; col1 at 516 (pair centred on the canvas mid)
  colStep: 312,
  titleY: 36, // header chip centre below the sheet's top edge
  row0Offset: 128, // row0 centre below the sheet's top edge (20px clear of the title chip)
  rowStep: 114,
  bottomPad: 26,
} as const;

/** Sheet height for a given grid row count (drives bg, slide, everything). */
export function sheetHeightFor(rows: number): number {
  return SHEET_LAYOUT.row0Offset + (rows - 1) * SHEET_LAYOUT.rowStep + SHEET_LAYOUT.cardH / 2 + SHEET_LAYOUT.bottomPad;
}

/** Grid rows a kind-count needs: ≤4 kinds → 2×N (grows at L6); 5 kinds
 * (grove) → the full 2×3 with the reserved top-right gap. */
function gridRows(count: number): number {
  return count > 4 ? 3 : Math.max(1, Math.ceil(count / 2));
}

/** Card centre + width for each of `count` build kinds — pure, so showBuild
 * and the e2e scripts can never disagree about where a card is. Slot order
 * for the 5-kind grid: grove (top-left), then ember/prism, then halo/kiln
 * — top-right of row 1 is RESERVED and emits no slot. */
export function buildCardSlots(
  width: number,
  height: number,
  count: number,
): { x: number; y: number; w: number }[] {
  const rows = gridRows(count);
  const top = height - sheetHeightFor(rows);
  const rowY = (r: number) => top + SHEET_LAYOUT.row0Offset + r * SHEET_LAYOUT.rowStep;
  return Array.from({ length: count }, (_, i) => {
    let row: number;
    let col: number;
    if (count > 4) {
      // grove grid: i0 → row0/col0 (top-right reserved), i1.. → rows 1-2
      row = i === 0 ? 0 : 1 + Math.floor((i - 1) / 2);
      col = i === 0 ? 0 : (i - 1) % 2;
    } else {
      row = Math.floor(i / 2);
      col = i % 2;
    }
    // odd count's LAST card centres on screen instead of hugging the left
    const orphan = count <= 4 && count % 2 === 1 && i === count - 1;
    const x = orphan ? width / 2 : SHEET_LAYOUT.col0 + col * SHEET_LAYOUT.colStep;
    return { x, y: rowY(row), w: SHEET_LAYOUT.cardW };
  });
}

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
  /** Current sheet height in px (grows with grid rows — see sheetHeightFor). */
  private sheetH = sheetHeightFor(2);

  constructor(scene: GameScene) {
    this.scene = scene;
    const { width, height } = scene.scale;
    this.root = scene.add.container(0, 0).setDepth(60).setVisible(false);
    this.dim = scene.add.rectangle(width / 2, height / 2, width, height, 0x05070f, 0.6).setInteractive();
    this.dim.on('pointerup', () => this.close());
    this.root.add(this.dim);
    this.content = scene.add.container(0, height + this.sheetH);
    this.root.add(this.content);
  }

  /** Sheet backdrop for the current height (drawn per open — the grid grows). */
  private drawBg(): void {
    const { width, height } = this.scene.scale;
    const bg = this.scene.add.graphics();
    bg.fillStyle(C.card, 1);
    bg.fillRoundedRect(SHEET_LAYOUT.bgPadX, height - this.sheetH, width - 2 * SHEET_LAYOUT.bgPadX, this.sheetH + 60, 26);
    bg.lineStyle(2, C.line, 1);
    bg.strokeRoundedRect(SHEET_LAYOUT.bgPadX, height - this.sheetH, width - 2 * SHEET_LAYOUT.bgPadX, this.sheetH + 60, 26);
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
      y: open ? 0 : height + this.sheetH,
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

  /** Shared geometry for the e2e scripts (M4): the exact slots showBuild
   * renders for `count` kinds on the current canvas, plus the sheet bg span
   * (card edges must stay inside it). Click targets derive from these —
   * never from literals in the scripts. */
  cardSlotsFor(count: number): { x: number; y: number; w: number }[] {
    const { width, height } = this.scene.scale;
    return buildCardSlots(width, height, count);
  }

  sheetBgBounds(): { left: number; right: number } {
    const { width } = this.scene.scale;
    return { left: SHEET_LAYOUT.bgPadX, right: width - SHEET_LAYOUT.bgPadX };
  }

  private drawBuildCard(card: Phaser.GameObjects.Graphics, x: number, y: number, afford: boolean, w = 260): void {
    card.clear();
    card.fillStyle(C.card2, 1);
    card.fillRoundedRect(x - w / 2, y - 52, w, 108, 18);
    card.lineStyle(2, afford ? C.amber : C.line, afford ? 0.9 : 0.5);
    card.strokeRoundedRect(x - w / 2, y - 52, w, 108, 18);
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

  /** Sheet for an empty tile: the build grid (2×N below L6; the grove
   * 2×3 with its reserved top-right gap from L6). */
  showBuild(tileIndex: number): void {
    this.content.removeAll(true);
    this.mode = 'build';
    this.tileIndex = tileIndex;
    this.buildCards = [];
    this.upg = null;
    this.sellLabel = null;
    // level gates which towers are buildable (progressive unlock); grove
    // leads the grid when present — its slot is top-left, top-right stays
    // reserved (empty) for a future tower
    const allKinds: TowerKind[] = ['ember', 'prism', 'halo', 'kiln', 'grove'];
    const kinds = allKinds.filter((k) => this.scene.level.towers.includes(k));
    const ordered: TowerKind[] = kinds.includes('grove')
      ? ['grove', ...kinds.filter((k) => k !== 'grove')]
      : kinds;
    this.sheetH = sheetHeightFor(ordered.length > 4 ? 3 : Math.max(1, Math.ceil(ordered.length / 2)));
    this.drawBg();
    const { width, height } = this.scene.scale;
    // header chip: bright label on its own pill so it reads against the sheet
    const titleY = height - this.sheetH + SHEET_LAYOUT.titleY;
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

    // positions come from buildCardSlots — the SAME source the e2e scripts
    // read via cardSlotsFor() (M4: one geometry, no forked test literals)
    const slots = buildCardSlots(width, height, ordered.length);
    ordered.forEach((kind, i) => {
      const { x, y, w: cardW } = slots[i];
      const cost = this.scene.buildCost(kind);

      const card = this.scene.add.graphics();
      const afford = this.scene.gold >= cost;
      this.drawBuildCard(card, x, y, afford, cardW);

      const icon = this.scene.add.image(x - 88, y, `tower_${kind}`).setScale(0.3);
      const textX = x - 38;
      // tier pips (matches the tower panel's language): three small dots
      for (let p = 0; p < 3; p++) {
        this.scene.add
          .image(x + 88 + (p - 1) * 14, y - 34, 'dot')
          .setTint(p === 0 ? C.amber : 0x2a3a63)
          .setScale(p === 0 ? 0.16 : 0.1)
          .setAlpha(p === 0 ? 0.95 : 0.55);
      }
      const name = this.scene.add
        .text(textX, y - 30, towerName(kind), { fontFamily: FONT, fontSize: '20px', color: CSS.white, fontStyle: 'bold' })
        .setResolution(2).setOrigin(0, 0.5);
      const blurb = this.scene.add
        .text(textX, y - 2, towerBlurb(kind), { fontFamily: FONT, fontSize: '14px', color: CSS.muted,
          wordWrap: { width: 168 } })
        .setResolution(2).setOrigin(0, 0.5);
      const costT = this.scene.add
        .text(textX, y + 26, `${cost} ${t('goldUnit')}`, {
          fontFamily: FONT, fontSize: '18px', color: afford ? CSS.amber : '#ff6b7a', fontStyle: 'bold',
        })
        .setResolution(2).setOrigin(0, 0.5);

      const zone = this.scene.add.zone(x, y, cardW, SHEET_LAYOUT.cardH).setInteractive({ useHandCursor: true });
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
    this.sheetH = sheetHeightFor(2);
    this.drawBg();
    const { height } = this.scene.scale;
    const def = tower.def;

    const icon = this.scene.add.image(77, height - this.sheetH + 52, `tower_${tower.kind}`).setScale(0.32);
    const name = this.scene.add
      .text(121, height - this.sheetH + 34, `${towerName(tower.kind)}  ·  ${tN('tier', tower.tier + 1)}`, {
        fontFamily: FONT, fontSize: '22px', color: CSS.white, fontStyle: 'bold',
      })
      .setResolution(2).setOrigin(0, 0.5);

    const next = tower.tier < 2 ? def.tiers[tower.tier + 1] : null;
    const line = (label: string, v: string, nv: string | null, i: number) => {
      const y = height - this.sheetH + 92 + i * 30;
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
    if (tower.kind === 'grove') {
      // support tower: damage/rate read as the empower it grants (live, runes applied)
      const gain = groveGainMult(this.scene.runes);
      const buff = def.tiers[tower.tier].buff ?? { dmg: 1, rate: 1 };
      const eff = { dmg: 1 + (buff.dmg - 1) * gain, rate: 1 + (buff.rate - 1) * gain };
      const nb = next?.buff;
      const nEff = nb ? { dmg: 1 + (nb.dmg - 1) * gain, rate: 1 + (nb.rate - 1) * gain } : null;
      line('damage', `+${Math.round((eff.dmg - 1) * 100)}%`, nEff ? `+${Math.round((nEff.dmg - 1) * 100)}%` : null, 0);
      line('rate', `+${Math.round((eff.rate - 1) * 100)}%`, nEff ? `+${Math.round((nEff.rate - 1) * 100)}%` : null, 1);
    } else {
      line('damage', `${Math.round(tower.dmg)}`, next ? `${Math.round(def.tiers[tower.tier + 1].dmg)}` : null, 0);
      line('rate', `${tower.rate.toFixed(1)}/s`, next ? `${def.tiers[tower.tier + 1].rate.toFixed(1)}/s` : null, 1);
    }
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
