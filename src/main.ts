// Watchlight entry point.
// iOS-first configuration: FIT scaling (one canvas size, CSS-scaled — avoids
// the iOS Safari canvas resize leak), 60fps rAF cap, portrait lock via CSS.
import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { MenuScene } from './scenes/MenuScene';
import { GameScene } from './scenes/GameScene';
import { loadSave } from './save';
import { audio } from './audio';
import { setLocale } from './i18n';
import { DEBUG } from './debug';

// locale before any scene text is created:
//   ?lang=ru|en (debug/override) > saved choice > device language
{
  const saved = loadSave().lang ?? 'auto';
  if (DEBUG.lang) setLocale(DEBUG.lang);
  else if (saved === 'auto') setLocale(navigator.language.toLowerCase().startsWith('ru') ? 'ru' : 'en');
  else setLocale(saved);
}

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'app',
  width: 720,
  height: 1280,
  backgroundColor: '#0b1020',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  render: {
    antialias: true,
    powerPreference: 'high-performance',
    failIfMajorPerformanceCaveat: false,
  },
  fps: { target: 60, min: 30 },
  disableContextMenu: true,
  scene: [BootScene, MenuScene, GameScene],
});

// restore mute preference + unlock audio on the very first gesture anywhere
audio.setMuted(loadSave().mute);
window.addEventListener(
  'pointerdown',
  () => audio.unlock(),
  { passive: true },
);

// PWA: offline-first service worker in production only (dev = fresh HMR)
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      /* offline mode unavailable — game still runs */
    });
  });
}

// iOS Safari: keep the canvas sized against dynamic viewport changes without
// recreating the backing store (debounced, per research §5.1)
let resizeTimer: ReturnType<typeof setTimeout> | undefined;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => game.scale.refresh(), 200);
});

// expose for the CDP smoke test (scripts/cdp-smoke.mjs) — read-only access
(window as unknown as { __game?: Phaser.Game }).__game = game;

export default game;
