// Pause + victory/defeat overlays. All block input behind a dim layer.
import Phaser from 'phaser';
import { C, CSS, FONT } from '../theme';
import { audio } from '../audio';
import { loadSave, patchSave } from '../save';
import { PillButton } from './Button';
import { t } from '../i18n';

export function showPause(scene: Phaser.Scene): void {
  const { width, height } = scene.scale;
  const dim = scene.add.rectangle(width / 2, height / 2, width, height, 0x05070f, 0.86)
    .setInteractive().setDepth(80);
  const panel = scene.add.container(width / 2, height / 2).setDepth(81);
  const card = scene.add.graphics();
  card.fillStyle(C.card, 1);
  card.fillRoundedRect(-260, -240, 520, 480, 24);
  card.lineStyle(2, C.line, 1);
  card.strokeRoundedRect(-260, -240, 520, 480, 24);
  panel.add(card);
  panel.add(
    scene.add
      .text(0, -180, t('paused'), { fontFamily: FONT, fontSize: '34px', color: CSS.white, fontStyle: 'bold' })
      .setResolution(2).setOrigin(0.5),
  );
  panel.add(
    new PillButton(scene, {
      x: 0, y: -70, w: 420, h: 62, label: t('resume'),
      onClick: () => {
        dim.destroy();
        panel.destroy();
        (scene as unknown as { resume: () => void }).resume();
      },
    }).container,
  );
  const sndLabel = () => (loadSave().mute ? t('soundOff') : t('soundOn'));
  const snd = new PillButton(scene, {
    x: 0, y: 10, w: 420, h: 62, label: sndLabel(),
    color: C.card2, textColor: CSS.white,
    onClick: () => {
      const m = !loadSave().mute;
      audio.setMuted(m);
      patchSave({ mute: m });
      snd.setLabel(sndLabel());
    },
  });
  panel.add(snd.container);
  panel.add(
    new PillButton(scene, {
      x: 0, y: 90, w: 420, h: 62, label: t('restartRun'),
      color: C.card2, textColor: CSS.white,
      onClick: () => (scene as unknown as { restartRun: () => void }).restartRun(),
    }).container,
  );
  panel.add(
    new PillButton(scene, {
      x: 0, y: 170, w: 420, h: 62, label: t('leaveToMenu'),
      color: C.card2, textColor: CSS.white,
      onClick: () => scene.scene.start('Menu'),
    }).container,
  );
}

export interface RunStats {
  wave: number;
  kills: number;
  leaks: number;
  earned: number;
}

export function showEnd(
  scene: Phaser.Scene,
  won: boolean,
  stats: RunStats,
  actions: { retry: () => void; menu: () => void; endless?: () => void; next?: { label: string; go: () => void } },
): void {
  const { width, height } = scene.scale;
  const dim = scene.add.rectangle(width / 2, height / 2, width, height, 0x05070f, 0.9)
    .setInteractive().setDepth(80);
  const panel = scene.add.container(width / 2, height / 2).setDepth(81);
  // (card drawn last — height hugs the content, see below)

  const title = won ? t('winTitle') : t('loseTitle');
  const titleColor = won ? CSS.amber : CSS.red;
  panel.add(
    scene.add
      .text(0, -300, title, { fontFamily: FONT, fontSize: '30px', color: titleColor, fontStyle: 'bold' })
      .setResolution(2).setOrigin(0.5),
  );

  if (won) {
    // stars: 3 = no leaks, 2 = ≤3 leaks, 1 = survived
    const stars = stats.leaks === 0 ? 3 : stats.leaks <= 3 ? 2 : 1;
    for (let i = 0; i < 3; i++) {
      const lit = i < stars;
      const x = -90 + i * 90;
      const d = scene.add.image(x, -220, 'spark')
        .setScale(lit ? 0.62 : 0.4)
        .setTint(lit ? C.amber : 0x2a3a63)
        .setAlpha(lit ? 1 : 0.6);
      panel.add(d);
      if (lit) {
        d.setScale(0.1);
        scene.tweens.add({ targets: d, scale: 0.62, duration: 320, delay: 250 + i * 220, ease: 'Back.easeOut' });
      }
    }
  }

  const lines = [
    `${t('stWaves')}   ${stats.wave}`,
    `${t('stKills')}   ${stats.kills}`,
    `${t('stLeaks')}   ${stats.leaks}`,
    `${t('stGold')}   ${stats.earned}`,
  ];
  const statsTop = won ? -150 : -190; // no star row on defeat — pull stats up to the title
  lines.forEach((t, i) => {
    panel.add(
      scene.add
        .text(0, statsTop + i * 44, t, { fontFamily: FONT, fontSize: '19px', color: CSS.muted })
        .setResolution(2).setOrigin(0.5),
    );
  });
  const statsBottom = statsTop + lines.length * 44;

  // buttons flow directly under the stats — no dead band on any variant
  const btnGap = 18;
  let by = statsBottom + 34;
  const close = () => {
    dim.destroy();
    panel.destroy();
  };
  // primary CTA (top): continue the campaign → next level, or endless after
  // the final level; "New run" is the replay path and never outranks it
  const hasPrimary = Boolean(actions.next || actions.endless);
  if (actions.next) {
    panel.add(
      new PillButton(scene, {
        x: 0, y: by + 33, w: 480, h: 66, label: actions.next.label,
        fontSize: 20,
        onClick: () => {
          close();
          actions.next?.go();
        },
      }).container,
    );
    by += 66 + btnGap;
  } else if (actions.endless) {
    panel.add(
      new PillButton(scene, {
        x: 0, y: by + 33, w: 480, h: 66, label: t('endlessCta'),
        color: C.violet, textColor: '#0b1020', fontSize: 20,
        onClick: () => {
          close();
          actions.endless?.();
        },
      }).container,
    );
    by += 66 + btnGap;
  }
  panel.add(
    new PillButton(scene, {
      x: 0, y: by + 33, w: 480, h: 66, label: t('newRun'),
      color: hasPrimary ? C.card2 : C.amber,
      textColor: hasPrimary ? CSS.white : '#101830',
      fontSize: 20,
      onClick: () => {
        close();
        actions.retry();
      },
    }).container,
  );
  by += 66 + btnGap;
  panel.add(
    new PillButton(scene, {
      x: 0, y: by + 33, w: 480, h: 66, label: t('menu'),
      color: C.card2, textColor: CSS.white, fontSize: 20,
      onClick: () => {
        close();
        actions.menu();
      },
    }).container,
  );
  by += 66;

  // card hugs the content: title → (stars) → stats → buttons
  const cardTop = -360;
  const cardH = by - cardTop + 36;
  const card = scene.add.graphics();
  card.fillStyle(C.card, 1);
  card.fillRoundedRect(-290, cardTop, 580, cardH, 24);
  card.lineStyle(2, won ? C.amber : C.red, 0.7);
  card.strokeRoundedRect(-290, cardTop, 580, cardH, 24);
  panel.addAt(card, 0); // behind all content

  // re-centre: content flows from cardTop down — shift so the CARD is centred
  panel.y = height / 2 - (cardTop + cardH / 2);

  panel.setAlpha(0);
  scene.tweens.add({ targets: panel, alpha: 1, duration: 300 });
}
