// Rune pick overlay — the roguelite hook, shown after every 5th wave.
import Phaser from 'phaser';
import { C, CSS, FONT } from '../theme';
import { RuneDef } from '../config';
import { makeRuneIcon } from './RuneIcon';
import { audio } from '../audio';
import { runeDesc, runeName, t } from '../i18n';

export class RuneOverlay {
  readonly root: Phaser.GameObjects.Container;
  /** card/icon sibling pairs — order contract for iconOrderValid(). */
  private cardIconPairs: { card: Phaser.GameObjects.Graphics; icon: Phaser.GameObjects.Container }[] = [];

  /** Invariant: each icon renders ABOVE its card (later sibling = on top).
   * Pinned by the e2e suite after a regression buried icons behind cards. */
  iconOrderValid(): boolean {
    return this.cardIconPairs.every(
      ({ card, icon }) => this.root.getIndex(icon) > this.root.getIndex(card),
    );
  }

  constructor(scene: Phaser.Scene, choices: RuneDef[], onPick: (r: RuneDef) => void) {
    const { width, height } = scene.scale;
    this.root = scene.add.container(0, 0).setDepth(70);

    const dim = scene.add.rectangle(width / 2, height / 2, width, height, 0x05070f, 0.9).setInteractive();
    this.root.add(dim);

    this.root.add(
      scene.add
        .text(width / 2, 232, t('runeHeader'), {
          fontFamily: FONT, fontSize: '24px', color: CSS.amber, fontStyle: 'bold',
        })
        .setResolution(2).setOrigin(0.5),
    );
    this.root.add(
      scene.add
        .text(width / 2, 270, t('runeSub'), {
          fontFamily: FONT, fontSize: '17px', color: CSS.muted,
        })
        .setResolution(2).setOrigin(0.5),
    );

    // card stack centred as a group (span ≈ 290..990 → centre 640 = screen centre)
    choices.forEach((rune, i) => {
      const y = 390 + i * 250;
      const card = scene.add.graphics();
      card.fillStyle(C.card, 1);
      card.fillRoundedRect(width / 2 - 290, y - 100, 580, 200, 22);
      card.lineStyle(2, rune.accent, 0.7);
      card.strokeRoundedRect(width / 2 - 290, y - 100, 580, 200, 22);

      // icon (shared renderer) — added via the array below, AFTER the card,
      // so it renders above the card fill (order matters in containers)
      const icon = makeRuneIcon(scene, rune, 52);
      icon.setPosition(width / 2 - 200, y);

      const name = scene.add
        .text(width / 2 - 130, y - 46, runeName(rune), {
          fontFamily: FONT, fontSize: '26px', color: CSS.white, fontStyle: 'bold',
        })
        .setResolution(2).setOrigin(0, 0.5);
      const desc = scene.add
        .text(width / 2 - 130, y - 8, runeDesc(rune), {
          fontFamily: FONT, fontSize: '19px', color: CSS.muted, wordWrap: { width: 380 },
        })
        .setResolution(2).setOrigin(0, 0);

      const zone = scene.add
        .zone(width / 2, y, 580, 200)
        .setInteractive({ useHandCursor: true });
      zone.on('pointerup', () => {
        audio.play('rune');
        scene.tweens.add({
          targets: this.root,
          alpha: 0,
          duration: 200,
          onComplete: () => {
            this.root.destroy();
            onPick(rune);
          },
        });
      });

      this.root.add([card, icon, name, desc, zone]);
      this.cardIconPairs.push({ card, icon });
    });

    this.root.setAlpha(0);
    scene.tweens.add({ targets: this.root, alpha: 1, duration: 220 });
  }
}
