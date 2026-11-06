// RuneButton — collapsed peek button + press-and-hold detail card.
// Collapsed: round button above the speed toggle showing the LAST claimed
// rune, with a "+N" chevron badge counting the rest. Pressing and holding
// expands a card listing every rune with its description; releasing
// collapses it. Empty state: dimmed lantern-diamond placeholder.
import Phaser from 'phaser';
import { C, CSS, FONT } from '../theme';
import { RuneDef } from '../config';
import { makeRuneIcon } from './RuneIcon';
import { runeDesc, runeName, tN } from '../i18n';

const BTN_X = 646; // exactly the speed toggle's column (was 654 — 8px drift)
const BTN_Y = 1097; // free band: right of the prep strip, above the bottom controls
const BTN_R = 36; // disc radius (72px touch target)
const CARD_RIGHT = 694;
const CARD_BOTTOM = 1040; // just above the button

export class RuneButton {
  readonly scene: Phaser.Scene;
  /** Smoke contract: owned rune count + expanded state. */
  runeCount = 0;
  expanded = false;

  private root: Phaser.GameObjects.Container;
  private disc: Phaser.GameObjects.Graphics;
  private iconHost: Phaser.GameObjects.Container;
  private badge: Phaser.GameObjects.Container;
  private badgeText!: Phaser.GameObjects.Text;
  private card?: Phaser.GameObjects.Container;
  private runes: RuneDef[] = []; // insertion order
  private lastRune: RuneDef | null = null;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.root = scene.add.container(BTN_X, BTN_Y).setDepth(53);

    this.disc = scene.add.graphics();
    this.root.add(this.disc);

    this.iconHost = scene.add.container(0, 0);
    this.root.add(this.iconHost);

    // "+N" chevron badge at the top-right of the disc
    this.badge = scene.add.container(BTN_R * 0.62, -BTN_R * 0.62);
    const bbg = scene.add.graphics();
    bbg.fillStyle(C.amber, 1);
    bbg.fillRoundedRect(-20, -12, 40, 24, 12);
    const chev = scene.add.graphics();
    chev.fillStyle(0x101830, 1);
    chev.beginPath();
    chev.moveTo(-11, 3);
    chev.lineTo(-5, -4);
    chev.lineTo(1, 3);
    chev.closePath();
    chev.fillPath();
    this.badgeText = scene.add
      .text(6, 0, '2', { fontFamily: FONT, fontSize: '15px', color: '#101830', fontStyle: 'bold' })
      .setResolution(2)
      .setOrigin(0, 0.5);
    this.badge.add([bbg, chev, this.badgeText]);
    this.badge.setVisible(false);
    this.root.add(this.badge);

    // empty-state placeholder glyph (dimmed lantern diamond)
    const ph = scene.add.graphics();
    ph.fillStyle(C.muted, 0.55);
    const r = 10;
    ph.beginPath();
    ph.moveTo(0, -r); ph.lineTo(r, 0); ph.lineTo(0, r); ph.lineTo(-r, 0);
    ph.closePath();
    ph.fillPath();
    this.iconHost.add(ph);

    this.drawDisc(1); // dim until a rune exists

    const zone = scene.add.zone(0, 0, BTN_R * 2, BTN_R * 2).setInteractive({ useHandCursor: true });
    this.root.add(zone);
    zone.on('pointerdown', () => this.expand());
    // release anywhere collapses (press-and-hold peek)
    scene.input.on('pointerup', () => {
      if (this.expanded) this.collapse();
    });
  }

  private drawDisc(alpha: number): void {
    this.disc.clear();
    this.disc.fillStyle(C.card2, alpha);
    this.disc.fillCircle(0, 0, BTN_R);
    this.disc.lineStyle(2, C.line, alpha);
    this.disc.strokeCircle(0, 0, BTN_R);
  }

  /** Full rebuild (scene create / restart). */
  setRunes(ordered: RuneDef[]): void {
    this.runes = [...ordered];
    this.runeCount = ordered.length;
    this.lastRune = ordered[ordered.length - 1] ?? null;
    this.refreshCollapsed();
  }

  addRune(rune: RuneDef): void {
    if (this.runes.some((r) => r.id === rune.id)) {
      // re-picked (Fortune): no new entry, just a pulse
      this.lastRune = rune;
      this.refreshCollapsed(true);
      return;
    }
    this.runes.push(rune);
    this.runeCount = this.runes.length;
    this.lastRune = rune;
    this.refreshCollapsed(true);
  }

  private refreshCollapsed(pulse = false): void {
    // icon: last rune's glyph, or dimmed placeholder when empty
    this.iconHost.removeAll(!!this.lastRune);
    if (this.lastRune) {
      const icon = makeRuneIcon(this.scene, this.lastRune, 22, false);
      this.iconHost.add(icon);
      this.drawDisc(1);
      if (pulse) {
        this.iconHost.setScale(1.35);
        this.scene.tweens.add({ targets: this.iconHost, scale: 1, duration: 300, ease: 'Back.easeOut' });
      }
    } else {
      const ph = this.scene.add.graphics();
      ph.fillStyle(C.muted, 0.55);
      const r = 10;
      ph.beginPath();
      ph.moveTo(0, -r); ph.lineTo(r, 0); ph.lineTo(0, r); ph.lineTo(-r, 0);
      ph.closePath();
      ph.fillPath();
      this.iconHost.add(ph);
      this.drawDisc(0.55);
    }

    // badge: count of runes beyond the one shown
    const more = this.runeCount - 1;
    this.badge.setVisible(more > 0);
    if (more > 0) this.badgeText.setText(`${more}`);
  }

  // ---------- expanded card ----------
  private buildCard(): void {
    const scene = this.scene;
    const runes = this.runes;
    const rowH = 56;
    const headH = 56;
    const height = headH + runes.length * rowH + 16;
    const width = 520;
    const left = CARD_RIGHT - width;
    const top = CARD_BOTTOM - height;

    const c = scene.add.container(0, 0).setDepth(69);
    const bg = scene.add.graphics();
    bg.fillStyle(C.card, 0.97);
    bg.fillRoundedRect(left, top, width, height, 20);
    bg.lineStyle(2, C.line, 1);
    bg.strokeRoundedRect(left, top, width, height, 20);
    c.add(bg);

    c.add(
      scene.add
        .text(left + 24, top + 18, tN('runeList', runes.length), {
          fontFamily: FONT, fontSize: '17px', color: CSS.amber, fontStyle: 'bold',
        })
        .setResolution(2).setOrigin(0, 0),
    );
    const divider = scene.add.graphics();
    divider.lineStyle(1, C.line, 0.8);
    divider.beginPath();
    divider.moveTo(left + 20, top + headH - 6);
    divider.lineTo(left + width - 20, top + headH - 6);
    divider.strokePath();
    c.add(divider);

    // newest first — the most recent pick is the most relevant
    const list = [...runes].reverse();
    list.forEach((rune, i) => {
      const y = top + headH + 8 + i * rowH;
      const icon = makeRuneIcon(scene, rune, 24);
      icon.setPosition(left + 46, y + rowH / 2 - 4);
      c.add(icon);
      c.add(
        scene.add
          .text(left + 88, y + 6, runeName(rune), {
            fontFamily: FONT, fontSize: '19px', color: CSS.white, fontStyle: 'bold',
          })
          .setResolution(2).setOrigin(0, 0),
      );
      c.add(
        scene.add
          .text(left + 88, y + 30, runeDesc(rune), {
            fontFamily: FONT, fontSize: '15px', color: CSS.muted, wordWrap: { width: width - 120 },
          })
          .setResolution(2).setOrigin(0, 0),
      );
    });

    this.card = c;
  }

  expand(): void {
    if (this.expanded || this.runeCount === 0) return;
    this.expanded = true;
    this.buildCard();
    const card = this.card!;
    card.setScale(0.7);
    card.setAlpha(0);
    this.scene.tweens.add({ targets: card, scale: 1, alpha: 1, duration: 160, ease: 'Cubic.easeOut' });
  }

  collapse(): void {
    if (!this.expanded || !this.card) return;
    this.expanded = false;
    const card = this.card;
    this.card = undefined;
    this.scene.tweens.add({
      targets: card,
      scale: 0.85,
      alpha: 0,
      duration: 140,
      ease: 'Cubic.easeIn',
      onComplete: () => card.destroy(),
    });
  }

  destroy(): void {
    this.card?.destroy();
    this.root.destroy();
  }
}
