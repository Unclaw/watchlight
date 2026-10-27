// MenuScene — title, animated Lantern, play/daily/sound.
// The whole screen is a giant tap target: any pointerdown unlocks audio
// (iOS AudioContext gesture rule) before any navigation happens.
import Phaser from 'phaser';
import { C, CSS, FONT } from '../theme';
import { audio } from '../audio';
import { loadSave, patchSave } from '../save';
import { LEVELS } from '../config';
import { PillButton } from '../ui/Button';
import { DEBUG } from '../debug';
import { getLocale, levelName, setLocale, statsLine, t, tN } from '../i18n';

export class MenuScene extends Phaser.Scene {
  constructor() {
    super('Menu');
  }

  create(): void {
    const { width, height } = this.scale;
    const cx = width / 2;

    // backdrop: deep field + soft radial lift behind the lantern
    this.cameras.main.setBackgroundColor(C.bg);
    const halo = this.add
      .image(cx, 430, 'glow')
      .setScale(5.5)
      .setTint(0x182448)
      .setAlpha(0.9)
      .setBlendMode(Phaser.BlendModes.ADD);

    // ---- title ----
    this.add
      .text(cx, 130, 'W A T C H L I G H T', {
        fontFamily: FONT,
        fontSize: '44px',
        color: CSS.white,
        fontStyle: 'bold',
      })
      .setResolution(2)
      .setOrigin(0.5)
      .setShadow(0, 0, CSS.amber, 18, true, true);
    this.add
      .text(cx, 180, t('tagline'), {
        fontFamily: FONT,
        fontSize: '19px',
        color: CSS.muted,
      })
      .setResolution(2)
      .setOrigin(0.5);

    // ---- the Lantern (only large animated sprite in the game) ----
    const lanternGlow = this.add
      .image(cx, 430, 'glow')
      .setScale(2.6)
      .setTint(C.amber)
      .setAlpha(0.55)
      .setBlendMode(Phaser.BlendModes.ADD);
    const lantern = this.add.image(cx, 430, 'lantern').setScale(0.5);
    this.tweens.add({
      targets: lanternGlow,
      scale: 3.1,
      alpha: 0.8,
      duration: 2400,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
    this.tweens.add({
      targets: lantern,
      scale: 0.54,
      duration: 2400,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
    this.tweens.add({
      targets: halo,
      alpha: 0.6,
      duration: 3600,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

    // drifting murk motes for atmosphere (cheap, additive, few)
    for (let i = 0; i < 10; i++) {
      const m = this.add
        .image(Phaser.Math.Between(40, width - 40), Phaser.Math.Between(240, 900), 'dot')
        .setTint(0xff5f7a)
        .setScale(Phaser.Math.FloatBetween(0.05, 0.12))
        .setAlpha(Phaser.Math.FloatBetween(0.15, 0.4))
        .setBlendMode(Phaser.BlendModes.ADD);
      this.tweens.add({
        targets: m,
        y: m.y - Phaser.Math.Between(60, 140),
        x: m.x + Phaser.Math.Between(-40, 40),
        alpha: 0,
        duration: Phaser.Math.Between(4000, 8000),
        repeat: -1,
        delay: Phaser.Math.Between(0, 4000),
        onRepeat: () => {
          m.setX(Phaser.Math.Between(40, width - 40));
          m.setY(Phaser.Math.Between(500, 950));
        },
      });
    }

    // ---- stats line ----
    const save = loadSave();
    const stats = save.bestWave > 0
      ? statsLine(save.bestWave, save.wins, save.totalKills)
      : t('noRuns');
    this.add
      .text(cx, 600, stats, { fontFamily: FONT, fontSize: '17px', color: CSS.muted })
      .setResolution(2)
      .setOrigin(0.5);

    // ---- level select: 3-across cards (tap to start) ----
    const CARD_W = 214, CARD_H = 128, GAP = 15, ROW_Y = 690;
    LEVELS.forEach((level, i) => {
      const stars = save.levelStars[level.id] ?? 0;
      const unlocked = level.id === 1 || (save.levelStars[level.id - 1] ?? 0) > 0;
      // symmetric around cx: centers 131 / 360 / 589 (24px side margins)
      const cxCard = 24 + CARD_W / 2 + i * (CARD_W + GAP);

      const card = this.add.graphics();
      card.fillStyle(unlocked ? C.card : C.bg2, 1);
      card.fillRoundedRect(cxCard - CARD_W / 2, ROW_Y - CARD_H / 2, CARD_W, CARD_H, 18);
      card.lineStyle(2, unlocked ? C.line : 0x1c2947, 1);
      card.strokeRoundedRect(cxCard - CARD_W / 2, ROW_Y - CARD_H / 2, CARD_W, CARD_H, 18);

      this.add
        .text(cxCard, ROW_Y - 44, `${t('lv')}${level.id}`, {
          fontFamily: FONT, fontSize: '15px', color: unlocked ? CSS.amber : CSS.muted, fontStyle: 'bold',
        })
        .setResolution(2).setOrigin(0.5);
      this.add
        .text(cxCard, ROW_Y - 16, levelName(level.id), {
          fontFamily: FONT, fontSize: '18px', color: unlocked ? CSS.white : CSS.muted, fontStyle: 'bold',
          wordWrap: { width: CARD_W - 20 }, align: 'center',
        })
        .setResolution(2).setOrigin(0.5);
      this.add
        .text(cxCard, ROW_Y + 12, tN('waves', level.waves.length), {
          fontFamily: FONT, fontSize: '14px', color: CSS.muted,
        })
        .setResolution(2).setOrigin(0.5);

      if (unlocked) {
        const glyphs = '\u25c6\u25c6\u25c6'.slice(0, stars) + '\u25c7\u25c7\u25c7'.slice(0, 3 - stars);
        this.add
          .text(cxCard, ROW_Y + 42, glyphs, {
            fontFamily: FONT, fontSize: '15px', color: stars > 0 ? CSS.amber : CSS.muted,
          })
          .setResolution(2).setOrigin(0.5);
      } else {
        // small padlock glyph
        const lock = this.add.graphics();
        lock.lineStyle(2.5, C.muted, 0.8);
        lock.strokeCircle(cxCard, ROW_Y + 37, 6);
        lock.fillStyle(C.muted, 0.8);
        lock.fillRoundedRect(cxCard - 9, ROW_Y + 37, 18, 14, 4);
      }

      const zone = this.add.zone(cxCard, ROW_Y, CARD_W, CARD_H).setInteractive({ useHandCursor: true });
      zone.on('pointerup', () => {
        if (!unlocked) {
          audio.play('deny');
          return;
        }
        audio.unlock();
        audio.play('tap');
        this.scene.start('Game', { mode: 'level', levelId: level.id });
      });
    });

    // ---- daily, endless, sound & help: flow layout with a consistent rhythm ----
    let y = 830;
    new PillButton(this, {
      x: cx, y, w: 460, h: 60, label: t('daily'),
      color: C.cyan, textColor: '#0b1020', fontSize: 18,
      onClick: () => this.scene.start('Game', { mode: 'daily' }),
    });
    y += 70;

    // endless unlocks only after the FINAL campaign level is cleared — it
    // plays the endgame map, so offering it earlier is a difficulty trap
    const clearedFinal = (save.levelStars[LEVELS[LEVELS.length - 1].id] ?? 0) > 0;
    if (clearedFinal) {
      new PillButton(this, {
        x: cx, y, w: 460, h: 60, label: t('endless'),
        color: C.violet, textColor: '#0b1020', fontSize: 18,
        onClick: () => this.scene.start('Game', { mode: 'endless' }),
      });
      y += 70;
    }

    const sndLabel = () => (loadSave().mute ? t('soundOff') : t('soundOn'));
    const snd = new PillButton(this, {
      x: 128, y, w: 208, h: 56, label: sndLabel(),
      color: C.card2, textColor: CSS.white, fontSize: 17,
      onClick: () => {
        const m = !loadSave().mute;
        audio.setMuted(m);
        patchSave({ mute: m });
        snd.setLabel(sndLabel());
      },
    });
    new PillButton(this, {
      x: 360, y, w: 208, h: 56, label: t('howTo'),
      color: C.card2, textColor: CSS.white, fontSize: 17,
      onClick: () => this.showHow(),
    });
    // language toggle: labelled in the TARGET language's own name (always
    // self-describing), applies instantly via a menu restart — the menu is
    // stateless so nothing is lost (no mid-run switch: that would kill a run)
    new PillButton(this, {
      x: 592, y, w: 208, h: 56, label: getLocale() === 'ru' ? 'English' : 'Русский',
      color: C.card2, textColor: CSS.white, fontSize: 17,
      onClick: () => {
        const next = getLocale() === 'ru' ? 'en' : 'ru';
        patchSave({ lang: next });
        setLocale(next);
        audio.play('tap');
        this.scene.restart();
      },
    });

    // audio unlock on ANY first touch (iOS rule: resume inside the handler)
    this.input.once('pointerdown', () => audio.unlock());

    this.add
      .text(cx, height - 40, 'alpha v0.3', {
        fontFamily: FONT,
        fontSize: '14px',
        color: CSS.muted,
      })
      .setResolution(2)
      .setOrigin(0.5)
      .setAlpha(0.7);

    // gentle intro: fade everything in
    this.cameras.main.fadeIn(400, 11, 16, 32);

    // debug hook: jump straight into a run (screenshots / smoke tests)
    if (DEBUG.jumpScene === 'game') {
      this.scene.start('Game', { mode: DEBUG.jumpMode ?? 'level', levelId: DEBUG.jumpLevel });
    }
  }

  private showHow(): void {
    const { width, height } = this.scale;
    const cx = width / 2;
    const dim = this.add.rectangle(cx, height / 2, width, height, 0x05070f, 0.88).setInteractive();
    const panel = this.add.container(cx, height / 2);

    const card = this.add.graphics();
    card.fillStyle(C.card, 0.98);
    card.fillRoundedRect(-300, -280, 600, 560, 24);
    card.lineStyle(2, C.line, 1);
    card.strokeRoundedRect(-300, -280, 600, 560, 24);
    panel.add(card);

    // explicit layout: title, five rules on a 56px rhythm, the star rule set
    // apart, then the button — nothing overlaps (the old i*56 step put the
    // last line at y=218, under the y=220 button)
    panel.add(
      this.add
        .text(0, -232, t('howTitle'), {
          fontFamily: FONT, fontSize: '26px', color: CSS.amber, fontStyle: 'bold',
          align: 'center', wordWrap: { width: 520 },
        })
        .setResolution(2).setOrigin(0.5, 0),
    );
    ([t('how1'), t('how2'), t('how3'), t('how4'), t('how5')] as const).forEach((line, i) => {
      panel.add(
        this.add
          .text(0, -164 + i * 56, line, {
            fontFamily: FONT, fontSize: '19px', color: CSS.white,
            align: 'center', wordWrap: { width: 520 },
          })
          .setResolution(2).setOrigin(0.5, 0),
      );
    });
    panel.add(
      this.add
        .text(0, 138, t('how6'), {
          fontFamily: FONT, fontSize: '19px', color: CSS.muted,
          align: 'center', wordWrap: { width: 520 },
        })
        .setResolution(2).setOrigin(0.5, 0),
    );

    const ok = new PillButton(this, {
      x: 0, y: 212, w: 220, h: 58, label: t('gotIt'),
      onClick: () => {
        dim.destroy();
        panel.destroy();
        ok.destroy();
      },
    });
    panel.add(ok.container);
  }
}
