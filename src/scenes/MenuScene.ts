// MenuScene — title, animated Lantern, biome hub, daily/endless/sound/help.
// The whole screen is a giant tap target: any pointerdown unlocks audio
// (iOS AudioContext gesture rule) before any navigation happens.
//
// Biome hub (variant A, operator-picked 2026-10-27): the Woodlands card is
// a PERSISTENT object — tapping it slides it up over the (still animating)
// lantern and grows the 2×5 level grid below it; tapping again reverses.
// No rebuild-on-toggle: layers persist and tween.
import Phaser from 'phaser';
import { C, CSS, FONT } from '../theme';
import { audio } from '../audio';
import { loadSave, patchSave } from '../save';
import { LEVELS, LevelDef } from '../config';
import { PillButton } from '../ui/Button';
import { DEBUG } from '../debug';
import { getLocale, levelName, setLocale, statsLine, t, tN, StrKey } from '../i18n';

/** Campaign biomes — level ranges live here as the campaign grows
 * (Woodlands 1-10 today; the others are "coming soon" teasers). */
const BIOME = {
  woodlands: { nameKey: 'biomeWoodlands' as StrKey, first: 1, last: 10 },
  deepmarsh: { nameKey: 'biomeDeepmarsh' as StrKey },
  ashen: { nameKey: 'biomeAshen' as StrKey },
};

// vertical choreography (collapsed → expanded)
const CARD_Y_COLLAPSED = 615;
const CARD_Y_EXPANDED = 415; // sits over the lantern — deliberate
const GRID_TOP = 522;
const GRID_PITCH = 98;

export class MenuScene extends Phaser.Scene {
  private expanded = false;
  private animating = false;
  private biomeCardC?: Phaser.GameObjects.Container;
  private chevT?: Phaser.GameObjects.Text;
  private teaserC?: Phaser.GameObjects.Container;
  private gridLayer?: Phaser.GameObjects.Container;
  private gridRows: Phaser.GameObjects.Container[] = [];
  private statsText?: Phaser.GameObjects.Text;

  constructor() {
    super('Menu');
  }

  create(): void {
    const { width, height } = this.scale;
    const cx = width / 2;
    this.expanded = false;
    this.animating = false;
    this.actionButtons = [];
    this.biomeCardC = undefined;
    this.chevT = undefined;
    this.teaserC = undefined;
    this.gridLayer = undefined;
    this.gridRows = [];

    // backdrop: deep field + soft radial lift behind the lantern
    this.cameras.main.setBackgroundColor(C.bg);
    const halo = this.add
      .image(cx, 340, 'glow')
      .setScale(4.2)
      .setTint(0x182448)
      .setAlpha(0.9)
      .setBlendMode(Phaser.BlendModes.ADD);
    this.tweens.add({
      targets: halo,
      alpha: 0.6,
      duration: 3600,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

    // ---- title ----
    this.add
      .text(cx, 108, 'W A T C H L I G H T', {
        fontFamily: FONT,
        fontSize: '44px',
        color: CSS.white,
        fontStyle: 'bold',
      })
      .setResolution(2)
      .setOrigin(0.5)
      .setShadow(0, 0, CSS.amber, 18, true, true);
    this.add
      .text(cx, 156, t('tagline'), {
        fontFamily: FONT,
        fontSize: '19px',
        color: CSS.muted,
      })
      .setResolution(2)
      .setOrigin(0.5);

    // ---- the Lantern — never hides; the expanded card simply overlaps it ----
    const lanternGlow = this.add
      .image(cx, 340, 'glow')
      .setScale(2.2)
      .setTint(C.amber)
      .setAlpha(0.55)
      .setBlendMode(Phaser.BlendModes.ADD);
    const lantern = this.add.image(cx, 340, 'lantern').setScale(0.44);
    this.tweens.add({
      targets: lanternGlow,
      scale: 2.6,
      alpha: 0.8,
      duration: 2400,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
    this.tweens.add({
      targets: lantern,
      scale: 0.48,
      duration: 2400,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

    // drifting murk motes for atmosphere (cheap, additive, few)
    for (let i = 0; i < 10; i++) {
      const m = this.add
        .image(Phaser.Math.Between(40, width - 40), Phaser.Math.Between(200, 860), 'dot')
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

    // ---- stats line (fades out while the grid is up) ----
    const save = loadSave();
    const stats = save.bestWave > 0
      ? statsLine(save.bestWave, save.wins, save.totalKills)
      : t('noRuns');
    this.statsText = this.add
      .text(cx, 505, stats, { fontFamily: FONT, fontSize: '17px', color: CSS.muted })
      .setResolution(2)
      .setOrigin(0.5);

    this.buildBiomeHub();
    this.buildActions();

    // audio unlock on ANY first touch (iOS rule: resume inside the handler)
    this.input.once('pointerdown', () => audio.unlock());

    this.add
      .text(cx, height - 40, 'alpha v0.4', {
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

  // ============================================================
  // Biome hub: persistent card + teasers + (hidden) level grid
  // ============================================================
  private biomeProgress(): { cleared: number; stars: number; total: number } {
    const save = loadSave();
    let cleared = 0;
    let stars = 0;
    for (let id = BIOME.woodlands.first; id <= BIOME.woodlands.last; id++) {
      const s = save.levelStars[id] ?? 0;
      if (s > 0) cleared++;
      stars += s;
    }
    return { cleared, stars, total: BIOME.woodlands.last - BIOME.woodlands.first + 1 };
  }

  private buildBiomeHub(): void {
    const { cleared, stars, total } = this.biomeProgress();

    // ---- The Woodlands card (the hub's living header) ----
    this.biomeCardC = this.biomeCard(360, CARD_Y_COLLAPSED, 460, 150, {
      name: t(BIOME.woodlands.nameKey),
      line1: tN('levelsCleared', cleared, total),
      line2: tN('starsTotal', stars, total * 3),
      sub: tN('biomeLevels', total),
    });

    // ---- coming-soon teasers (fade away while expanded) ----
    this.teaserC = this.add.container(0, 0);
    this.teaserC.add(this.teaserCard(240, 762, 216, 116, t(BIOME.deepmarsh.nameKey)));
    this.teaserC.add(this.teaserCard(480, 762, 216, 116, t(BIOME.ashen.nameKey)));

    // ---- the 2×5 level grid, hidden until the card opens ----
    const grid = this.add.container(0, 0).setVisible(false).setAlpha(0);
    this.gridLayer = grid;
    LEVELS.forEach((level, i) => {
      const row = this.add.container(0, 0);
      grid.add(row);
      this.gridRows.push(row);
      const x = i % 2 === 0 ? 240 : 480;
      const y = GRID_TOP + Math.floor(i / 2) * GRID_PITCH;
      this.levelCard(row, level, x, y, 220, 90, 'compact');
    });
  }

  /** Expand/collapse — the card slides up over the lantern, the grid grows
   *  beneath it, teasers/stats swap out. All gentle tweens, no rebuild. */
  private toggleExpanded(): void {
    if (this.animating) return;
    this.animating = true;
    this.expanded = !this.expanded;
    const on = this.expanded;
    this.chevT?.setText(on ? '▾' : '▸');

    // the card itself
    this.tweens.add({
      targets: this.biomeCardC,
      y: on ? CARD_Y_EXPANDED : CARD_Y_COLLAPSED,
      duration: 300,
      ease: 'Cubic.easeOut',
    });

    // stats + teasers fade OUT on expand and back IN on collapse — visible
    // from the start of the tween so the fade-in actually renders
    this.statsText?.setVisible(true);
    this.teaserC?.setVisible(true);
    this.tweens.add({
      targets: [this.statsText, this.teaserC],
      alpha: on ? 0 : 1,
      duration: 200,
      ease: 'Sine.easeInOut',
      onComplete: () => {
        const hide = on;
        this.statsText?.setVisible(!hide);
        this.teaserC?.setVisible(!hide);
      },
    });

    if (on) {
      this.gridLayer?.setVisible(true);
      this.tweens.add({
        targets: this.gridLayer,
        alpha: 1,
        duration: 200,
        ease: 'Sine.easeOut',
      });
      // slight stagger per grid row — the grid "grows"
      this.gridRows.forEach((row, i) => {
        row.setAlpha(0).setY(26);
        this.tweens.add({
          targets: row,
          alpha: 1,
          y: 0,
          duration: 240,
          delay: 60 + i * 36,
          ease: 'Cubic.easeOut',
        });
      });
      this.time.delayedCall(60 + 5 * 36 + 260, () => (this.animating = false));
    } else {
      this.tweens.add({
        targets: this.gridLayer,
        alpha: 0,
        duration: 200,
        ease: 'Sine.easeIn',
        onComplete: () => this.gridLayer?.setVisible(false),
      });
      this.time.delayedCall(320, () => (this.animating = false));
    }
  }

  /** A big biome identity card: treeline strip + name + progress. Tapping
   *  it toggles the hub. The tap zone is created at the CONTAINER-RELATIVE
   *  origin (the container itself sits at x,y — doubling it once bit us). */
  private biomeCard(
    x: number, y: number, w: number, h: number,
    opts: { name: string; line1: string; line2: string; sub: string },
  ): Phaser.GameObjects.Container {
    const c = this.add.container(x, y);
    const g = this.add.graphics();
    g.fillStyle(C.card, 1);
    g.fillRoundedRect(-w / 2, -h / 2, w, h, 18);
    g.lineStyle(2, C.line, 1);
    g.strokeRoundedRect(-w / 2, -h / 2, w, h, 18);
    // treeline identity strip along the bottom of the card
    const strip = this.add.graphics();
    for (let i = 0; i < 16; i++) {
      const tx = -w / 2 + 12 + (i / 15) * (w - 24) + Phaser.Math.Between(-8, 8);
      const th = Phaser.Math.Between(26, 44);
      const base = h / 2 - 10;
      const tw = th * 0.42;
      strip.fillStyle(0x0a1226, Phaser.Math.FloatBetween(0.55, 0.85));
      strip.fillTriangle(tx - tw, base, tx + tw, base, tx, base - th);
      strip.fillTriangle(tx - tw * 0.7, base - th * 0.38, tx + tw * 0.7, base - th * 0.38, tx, base - th * 1.26);
    }
    strip.fillStyle(C.amber, 0.85); // a firefly over the treeline
    strip.fillCircle(-w / 2 + 40, h / 2 - 34, 2.5);
    strip.fillCircle(w / 2 - 60, h / 2 - 46, 2);
    const name = this.add
      .text(0, -h / 2 + 34, opts.name, { fontFamily: FONT, fontSize: '24px', color: CSS.white, fontStyle: 'bold' })
      .setResolution(2).setOrigin(0.5);
    const sub = this.add
      .text(0, -h / 2 + 62, opts.sub, { fontFamily: FONT, fontSize: '14px', color: CSS.muted })
      .setResolution(2).setOrigin(0.5);
    const p1 = this.add
      .text(0, 6, opts.line1, { fontFamily: FONT, fontSize: '15px', color: CSS.amber })
      .setResolution(2).setOrigin(0.5);
    const p2 = this.add
      .text(0, 28, opts.line2, { fontFamily: FONT, fontSize: '13px', color: CSS.muted })
      .setResolution(2).setOrigin(0.5);
    const chev = this.add
      .text(w / 2 - 22, -h / 2 + 22, '▸', { fontFamily: FONT, fontSize: '18px', color: CSS.amber })
      .setResolution(2).setOrigin(0.5);
    this.chevT = chev;
    c.add([g, strip, name, sub, p1, p2, chev]);
    const zone = this.add.zone(0, 0, w, h).setInteractive({ useHandCursor: true });
    zone.on('pointerup', () => {
      audio.unlock();
      audio.play('tap');
      this.toggleExpanded();
    });
    c.add(zone);
    return c;
  }

  /** Locked future-biome teaser card (static, muted). */
  private teaserCard(x: number, y: number, w: number, h: number, name: string): Phaser.GameObjects.Container {
    const c = this.add.container(x, y);
    const g = this.add.graphics();
    g.fillStyle(C.bg2, 0.9);
    g.fillRoundedRect(-w / 2, -h / 2, w, h, 16);
    g.lineStyle(2, 0x1c2947, 1);
    g.strokeRoundedRect(-w / 2, -h / 2, w, h, 16);
    const strip = this.add.graphics();
    for (let i = 0; i < 8; i++) {
      const tx = -w / 2 + 14 + (i / 7) * (w - 28) + Phaser.Math.Between(-5, 5);
      const th = Phaser.Math.Between(14, 24);
      const base = h / 2 - 8;
      strip.fillStyle(0x0a1226, 0.5);
      strip.fillTriangle(tx - th * 0.4, base, tx + th * 0.4, base, tx, base - th);
    }
    const nameT = this.add
      .text(0, -h / 2 + 26, name, { fontFamily: FONT, fontSize: '16px', color: CSS.muted, fontStyle: 'bold', wordWrap: { width: w - 20 }, align: 'center' })
      .setResolution(2).setOrigin(0.5);
    const soon = this.add
      .text(0, 4, t('comingSoon'), { fontFamily: FONT, fontSize: '13px', color: CSS.muted })
      .setResolution(2).setOrigin(0.5);
    // padlock
    const lock = this.add.graphics();
    lock.lineStyle(2.5, C.muted, 0.7);
    lock.strokeCircle(0, 22, 5.5);
    lock.fillStyle(C.muted, 0.7);
    lock.fillRoundedRect(-8, 22, 16, 12, 4);
    c.add([g, strip, nameT, soon, lock]);
    return c;
  }

  // ============================================================
  // Level cards
  // ============================================================
  private levelCard(
    parent: Phaser.GameObjects.Container, level: LevelDef,
    x: number, y: number, w: number, h: number, scale: 'compact' | 'roomy',
  ): void {
    const save = loadSave();
    const stars = save.levelStars[level.id] ?? 0;
    const unlocked = level.id === 1 || (save.levelStars[level.id - 1] ?? 0) > 0;
    const card = this.add.graphics();
    card.fillStyle(unlocked ? C.card : C.bg2, 1);
    card.fillRoundedRect(x - w / 2, y - h / 2, w, h, 16);
    card.lineStyle(2, unlocked ? C.line : 0x1c2947, 1);
    card.strokeRoundedRect(x - w / 2, y - h / 2, w, h, 16);
    parent.add(card);

    const lvSize = scale === 'compact' ? '13px' : '15px';
    const nameSize = scale === 'compact' ? '16px' : '20px';
    const subSize = scale === 'compact' ? '12px' : '14px';
    const topY = y - h / 2 + (scale === 'compact' ? 19 : 30);
    const lvT = this.add
      .text(x - w / 2 + 14, topY, `${t('lv')}${level.id}`, { fontFamily: FONT, fontSize: lvSize, color: unlocked ? CSS.amber : CSS.muted, fontStyle: 'bold' })
      .setResolution(2).setOrigin(0, 0.5);
    const nameT = this.add
      .text(x, y - (scale === 'compact' ? 7 : 4), levelName(level.id), {
        fontFamily: FONT, fontSize: nameSize, color: unlocked ? CSS.white : CSS.muted, fontStyle: 'bold',
        wordWrap: { width: w - 16 }, align: 'center',
      })
      .setResolution(2).setOrigin(0.5);
    const glyphs = '\u25c6\u25c6\u25c6'.slice(0, stars) + '\u25c7\u25c7\u25c7'.slice(0, 3 - stars);
    const subY = y + h / 2 - (scale === 'compact' ? 17 : 26);
    let subT: Phaser.GameObjects.Text;
    if (unlocked) {
      subT = this.add
        .text(x, subY, `${glyphs}  ·  ${tN('waves', level.waves.length)}`, {
          fontFamily: FONT, fontSize: subSize, color: stars > 0 ? CSS.amber : CSS.muted,
        })
        .setResolution(2).setOrigin(0.5);
    } else {
      subT = this.add
        .text(x, subY, tN('waves', level.waves.length), { fontFamily: FONT, fontSize: subSize, color: CSS.muted })
        .setResolution(2).setOrigin(0.5);
      const lock = this.add.graphics();
      lock.lineStyle(2.5, C.muted, 0.8);
      lock.strokeCircle(x - 48, subY - 3, 6);
      lock.fillStyle(C.muted, 0.8);
      lock.fillRoundedRect(x - 57, subY - 3, 18, 14, 4);
      parent.add(lock);
    }
    parent.add([lvT, nameT, subT]);
    const zone = this.add.zone(x, y, w, h).setInteractive({ useHandCursor: true });
    zone.on('pointerup', () => {
      if (!unlocked) {
        audio.play('deny');
        return;
      }
      audio.unlock();
      audio.play('tap');
      this.scene.start('Game', { mode: 'level', levelId: level.id });
    });
    parent.add(zone);
  }

  // ============================================================
  // Daily / endless + utility rows
  // ============================================================
  private actionButtons: PillButton[] = [];

  private buildActions(): void {
    this.actionButtons.forEach((b) => b.destroy());
    this.actionButtons = [];
    const save = loadSave();
    const cx = 360;
    const clearedFinal = (save.levelStars[LEVELS[LEVELS.length - 1].id] ?? 0) > 0;
    const BY_ROW = 1064;
    const daily = new PillButton(this, {
      x: clearedFinal ? 248 : cx, y: BY_ROW, w: clearedFinal ? 448 : 460, h: 56, label: t('daily'),
      color: C.cyan, textColor: '#0b1020', fontSize: 18,
      onClick: () => this.scene.start('Game', { mode: 'daily' }),
    });
    this.actionButtons.push(daily);
    if (clearedFinal) {
      this.actionButtons.push(
        new PillButton(this, {
          x: 472, y: BY_ROW, w: 448, h: 56, label: t('endless'),
          color: C.violet, textColor: '#0b1020', fontSize: 18,
          onClick: () => this.scene.start('Game', { mode: 'endless' }),
        }),
      );
    }

    const sndLabel = () => (loadSave().mute ? t('soundOff') : t('soundOn'));
    const snd = new PillButton(this, {
      x: 128, y: 1136, w: 208, h: 56, label: sndLabel(),
      color: C.card2, textColor: CSS.white, fontSize: 17,
      onClick: () => {
        const m = !loadSave().mute;
        audio.setMuted(m);
        patchSave({ mute: m });
        snd.setLabel(sndLabel());
      },
    });
    this.actionButtons.push(snd);
    this.actionButtons.push(
      new PillButton(this, {
        x: 360, y: 1136, w: 208, h: 56, label: t('howTo'),
        color: C.card2, textColor: CSS.white, fontSize: 17,
        onClick: () => this.showHow(),
      }),
    );
    // language toggle: labelled in the TARGET language's own name (always
    // self-describing), applies instantly via a menu restart — the menu is
    // stateless so nothing is lost (no mid-run switch: that would kill a run)
    this.actionButtons.push(
      new PillButton(this, {
        x: 592, y: 1136, w: 208, h: 56, label: getLocale() === 'ru' ? 'English' : 'Русский',
        color: C.card2, textColor: CSS.white, fontSize: 17,
        onClick: () => {
          const next = getLocale() === 'ru' ? 'en' : 'ru';
          patchSave({ lang: next });
          setLocale(next);
          audio.play('tap');
          this.scene.restart();
        },
      }),
    );
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
