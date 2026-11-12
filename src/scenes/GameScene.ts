// GameScene — the run. A fixed clock drives all gameplay (pause-aware,
// speed-scaled); Phaser timers/tweens are visuals-only by design.
import Phaser from 'phaser';
import {
  C, CSS, FONT, ENEMY_COLOR,
} from '../theme';
import {
  BESTIARY_LEVEL, EnemyKind, GAME_H, GAME_W, LEVELS, LevelDef, PATH_WIDTH, PathIndex,
  COMBAT, RUNES, RuneDef, SpawnGroup, TowerKind, LevelTheme, THEMES,
  makePath, waveBonus, waveGroups, BOSS_LIKES,
} from '../config';
import { Rng, todayDailySeed } from '../rng';
import { audio } from '../audio';
import { loadSave, patchSave } from '../save';
import { Enemy } from '../entities/Enemy';
import { Tower } from '../entities/Tower';
import { BuildSheet } from '../ui/BuildSheet';
import { RuneOverlay } from '../ui/RuneOverlay';
import { RuneButton } from '../ui/RuneButton';
import { showPause, showEnd } from '../ui/Overlays';
import { Fx } from '../systems/Fx';
import { hasChains, beamWidthMult } from '../runes';
import { RuneId } from '../runes-ids';
import { DEBUG, debugState } from '../debug';
import { levelName, t, tN } from '../i18n';
import type { StrKey } from '../i18n';
import { groveBuffFor as groveBuffCore, towerBuildCost } from '../sim/stats';
import { killBounty, summonDropDists } from '../sim/enemy';
import {
  beamGeom, beamHits, beamWidth, chainTargets, splashHits, stepBoltCore, stepShellCore,
} from '../sim/combat';
import { buildSpawnQueue, leakDamage, runeInstants, runeOfferPool, SpawnAt } from '../sim/waves';
import { WAKELOCK_LOST } from '../wakeLock';
import { Hud } from '../systems/Hud';

type RunMode = 'level' | 'daily' | 'endless';
type Phase = 'ready' | 'wave' | 'rune' | 'over' | 'won';

/** First-time mechanic tips (A2): level id → i18n key. Shown once per save
 * at level start; the flyer tip pairs with the lane preview (A1). */
const LEVEL_TIPS: Partial<Record<number, StrKey>> = {
  2: 'tipFlyers',
  4: 'tipHealers',
  6: 'tipGrove',
  10: 'tipHeartwood',
};

interface Bolt {
  sprite: Phaser.GameObjects.Image;
  x: number;
  y: number;
  target: Enemy | null;
  dest: { x: number; y: number };
  speed: number;
  dmg: number;
  color: number;
  owner: Tower | null;
}

interface Shell {
  sprite: Phaser.GameObjects.Image;
  from: { x: number; y: number };
  to: { x: number; y: number };
  t: number;
  dur: number;
  dmg: number;
  radius: number;
  color: number;
}

interface Tile {
  x: number;
  y: number;
  sprite: Phaser.GameObjects.Image;
  zone: Phaser.GameObjects.Zone;
  tower: Tower | null;
}

/** Radial glow drawn as ring circles — the vector equivalent of the
 * 'glow' texture (BootScene glowRings, 6 rings + opaque 18% core) at sprite
 * alpha `mult`. Ring alphas are solved recursively so the CUMULATIVE
 * sequential blend equals the texture's cumulative × mult exactly at every
 * band (naive per-ring ×mult overshoots inner bands — blending isn't
 * linear). Used by the static bake; the core is filled separately where an
 * additive-equivalent colour is needed. */
function glowRingRecipe(g: Phaser.GameObjects.Graphics, cx: number, cy: number, R: number, color: number, mult: number): void {
  const N = 6;
  const a: number[] = [];
  for (let i = 1; i <= N; i++) a[i] = 0.05 * ((N - i + 1) / N) + 0.03; // texture ring alphas
  // cumulative texture alpha inside band k (rings k..N all cover it)
  const T: number[] = [];
  T[N + 1] = 0;
  for (let k = N; k >= 1; k--) T[k] = 1 - (1 - T[k + 1]) * (1 - a[k]);
  const s: number[] = [];
  for (let k = N + 1; k >= 1; k--) s[k] = mult * T[k]; // target cumulative
  for (let k = N; k >= 1; k--) {
    const c = 1 - (1 - s[k]) / (1 - s[k + 1]); // solved per-ring alpha
    g.fillStyle(color, c);
    g.fillCircle(cx, cy, (R * k) / N);
  }
}

export class GameScene extends Phaser.Scene {
  // --- run state ---
  mode: RunMode = 'level';
  levelId = 1;
  /** The level being played (daily/endless run on the full level 3 map). */
  level: LevelDef = LEVELS[0];
  /** Precomputed path index for the level's waypoints. */
  path: PathIndex = makePath(LEVELS[0].map.waypoints);
  private rng = new Rng(1); // combat variance: enemy speed, flyer spawn picks
  private waveRng = new Rng(2); // endless wave composition (own stream)
  private runeRng = new Rng(3); // rune shuffles (own stream)
  gold = 0;
  private hp = 0;
  private maxHp = 0;
  private waveIndex = 1; // next wave to start
  phase: Phase = 'ready'; // public: entities (sell refund) + smoke read it
  private endlessUnlocked = false;
  readonly runes = new Set<string>();
  gameTime = 0;
  private speedMult = 1;
  private paused = false;
  // run-over state lives in `phase === 'over'` alone (M1: no `over` mirror;
  // `endlessUnlocked` stays — it's a one-way latch the endless-continue
  // button flips, not phase-derivable)

  private kills = 0;
  private leaks = 0;
  private earned = 0;
  private demo = false;

  // --- entities ---
  enemies: Enemy[] = [];
  towers: Tower[] = [];
  private bolts: Bolt[] = [];
  private shells: Shell[] = [];
  private tiles: Tile[] = [];

  // --- wave spawning ---
  private spawnQueue: SpawnAt[] = [];
  private waveTime = 0;
  /** Composition of the upcoming wave — computed once at wave end so the
   * preview can show it without desyncing the seeded RNG on endless waves. */
  private nextWaveGroups: SpawnGroup[] | null = null;
  /** Composition of the wave currently running (for the remaining tracker). */
  private currentWaveGroups: SpawnGroup[] | null = null;
  /** Smoke-visible strip state: 'next' (prep) | 'remaining' (wave) | null (hidden). */
  waveStripMode: 'next' | 'remaining' | null = null;

  // --- ui refs ---
  private sheet!: BuildSheet;
  private hud!: Hud;
  private selectedTile = -1;
  private selRing!: Phaser.GameObjects.Graphics;
  private rangeRing!: Phaser.GameObjects.Arc;
  private banner?: Phaser.GameObjects.Text;
  private lanternGlow?: Phaser.GameObjects.Image;
  private lanternTween?: Phaser.Tweens.Tween;
  /** Prep-only dashed preview of flyer lanes (visible when the NEXT wave
   * has flyers — the wave strip says what, this says where). */
  private flyerLanes?: Phaser.GameObjects.Graphics;
  /** Static per-run GRAPHICS collected at map draw, composited ONCE into
   * an opaque baked texture by bakeStatics() (perf 2026-11-11: the static
   * stack was ~58% of every frame on weak GPUs; Phaser re-tessellates and
   * re-blends Graphics every frame). Images/ADD glows CANNOT go through
   * this path — sprite-batched draws into a RenderTexture corrupt its
   * alpha (verified by probe, Phaser 3.90) — so only Graphics is baked;
   * the few glow/marker IMAGES stay live above the bake. Order matters:
   * creation order IS the draw order inside the bake. */
  private statics: Phaser.GameObjects.GameObject[] = [];
  /** Vignette corners — baked as black ring-Graphics into a separate
   * TRANSPARENT texture at depth 7 (black is alpha-math-exact there;
   * they must layer above tiles/towers, so they can't join the opaque
   * background bake). */
  private vignetteStatics: Phaser.GameObjects.GameObject[] = [];
  runeButton?: RuneButton; // press-and-hold rune peek (smoke reads it)
  activeRuneOverlay?: RuneOverlay; // smoke contract: iconOrderValid()
  private fx!: Fx;
  private lastHud = 0;

  constructor() {
    super('Game');
  }

  init(data: { mode?: RunMode; levelId?: number }): void {
    this.mode = data.mode === 'daily' || data.mode === 'endless' ? data.mode : 'level';
    this.levelId = data.levelId ?? 1;
    // daily + endless play the full-bestiary map (flagged in config, not by index)
    this.level = this.mode === 'level' ? (LEVELS[this.levelId - 1] ?? LEVELS[0]) : BESTIARY_LEVEL;
    this.path = makePath(this.level.map.waypoints);
    // one master seed, forked per concern: daily runs stay reproducible even
    // if a consumer is added/removed in an unrelated stream
    this.rng = new Rng(this.mode === 'daily' ? todayDailySeed() : Math.floor(Math.random() * 2 ** 31));
    this.waveRng = this.rng.fork(1);
    this.runeRng = this.rng.fork(2);
  }

  create(): void {
    // FULL reset of every field that holds game objects or run state:
    // scene.restart() destroys the display list but does NOT re-run field
    // initializers, so anything not cleared here would be a stale reference
    // into destroyed objects from the previous run.
    this.enemies = [];
    this.towers = [];
    this.bolts = [];
    this.shells = [];
    this.tiles = [];
    this.spawnQueue = [];
    this.waveTime = 0;
    this.nextWaveGroups = null;
    this.currentWaveGroups = null;
    this.pendingRuneChoices = [];
    this.waveStripMode = null;
    this.selectedTile = -1;
    this.lastHud = 0;
    this.banner = undefined;
    this.lanternGlow = undefined;
    this.lanternTween = undefined;
    this.flyerLanes = undefined;
    this.statics = [];
    this.vignetteStatics = [];
    this.runeButton = undefined;
    this.activeRuneOverlay = undefined;
    if (this.hpBars) this.hpBars.destroy(); // may survive from a prior create()
    this.hpBars = undefined;
    this.runes.clear();
    this.gold = this.level.startGold;
    this.hp = this.level.lanternHp;
    this.maxHp = this.level.lanternHp;
    this.waveIndex = 1;
    this.phase = 'ready';
    this.endlessUnlocked = this.mode === 'endless';
    this.gameTime = 0;
    this.speedMult = 1;
    this.paused = false;
    this.kills = 0;
    this.leaks = 0;
    this.earned = 0;

    this.drawMap();
    this.createFx();
    this.createTiles();
    this.createHud();
    this.sheet = new BuildSheet(this);
    this.selRing = this.add.graphics().setDepth(14);
    this.rangeRing = this.add.arc(0, 0, 10).setStrokeStyle(2, 0xeef2ff, 0.35).setVisible(false).setDepth(5);

    // auto-pause when iOS Safari background the tab (research D8) — and when
    // the screen LOCKS (wake-lock release; audio hard-stops via main.ts).
    // WAKELOCK_LOST dispatches on window and doesn't bubble — listen there.
    document.addEventListener('visibilitychange', this.onHidden);
    window.addEventListener(WAKELOCK_LOST, this.onLockLost);

    // first-wave preview (wave 1 is a pure table lookup — no RNG consumed)
    this.nextWaveGroups = waveGroups(this.level, 1, this.waveRng);
    this.time.delayedCall(700, () => {
      if (this.phase === 'ready') this.setStrip('next');
    });

    // first-time mechanic tip (once per save; marked seen when it fires)
    const tipKey = this.mode === 'level' && !this.demo ? LEVEL_TIPS[this.level.id] : undefined;
    if (tipKey && !loadSave().tips[this.level.id]) {
      this.time.delayedCall(1600, () => {
        if (this.phase !== 'ready') return; // already fighting — don't interrupt
        patchSave({ tips: { [this.level.id]: true } });
        this.showBanner(t(tipKey), CSS.violet, 3800, '21px');
      });
    }

    // debug/testing hooks: see src/debug.ts (?scene=game&auto=1[&demo=1&restart=1&assert=1])
    this.demo = DEBUG.demo;
    if (this.demo) {
      // CI smoke: build one of each tower, then run waves automatically
      this.gold += 600;
      // build every kind this level allows (CI: proves the roster gate)
      this.level.towers.forEach((kind, i) => this.buildTower(i, kind));
    }
    if (DEBUG.auto || this.demo) {
      this.time.delayedCall(500, () => {
        if (this.phase === 'ready') this.startWave();
      });
    }
    // CI smoke: reproduce the "Restart run" button path mid-game
    if (DEBUG.restart && !debugState.restartFired) {
      debugState.restartFired = true;
      this.time.delayedCall(2500, () => this.scene.restart({ mode: this.mode }));
    }
    // CI smoke: in-page assertions after (optional) restart
    if (DEBUG.assert) {
      this.time.delayedCall(3200, () => {
        const expected = this.level.map.tiles.length;
        const okTiles = this.tiles.length === expected && this.tiles.every((t) => t.zone.scene && t.sprite.scene);
        const up = this.towers.filter((t) => t.upgradeMarkerVisible).length;
        console.log(`SMOKE_ASSERT tiles=${this.tiles.length}/${expected} alive=${okTiles} enemies=${this.enemies.length} wave=${this.waveIndex} gold=${this.gold} chevrons=${up}/${this.towers.length}`);
      });
    }
    this.events.once('shutdown', () => {
      document.removeEventListener('visibilitychange', this.onHidden);
      window.removeEventListener(WAKELOCK_LOST, this.onLockLost);
    });
  }

  private onHidden = (): void => {
    if (document.hidden && !this.paused && this.phase !== 'over' && this.phase !== 'won') {
      this.openPause();
    }
  };

  /** Screen locked mid-run (wake-lock released): full stop. On some OEM
   *  builds no visibilitychange fires for a lock, which used to leave the
   *  run simulating — and the soundscape feeding — in the pocket. */
  private onLockLost = (): void => {
    if (!this.paused && this.phase !== 'over' && this.phase !== 'won') {
      this.openPause();
    }
  };

  // ============================================================
  // Map & decor
  // ============================================================
  private drawMap(): void {
    const theme = this.levelTheme();
    this.cameras.main.setBackgroundColor(theme.bg);

    // soft radial lift behind the playfield — baked FIRST (directly over the
    // theme bg) as ring circles + additive-equivalent core, the same recipe
    // the 'glow' texture is generated from. Drawn under the sky/trees/path
    // (instead of additively over them) so nothing gets eaten; the huge ADD
    // quad leaves the per-frame render entirely (see bakeStatics).
    const lift = this.add.graphics();
    const R = (128 * 2) / 2 * 7; // glow texture half-size (128·S=2) × map scale 7
    const LCX = GAME_W / 2, LCY = 560;
    glowRingRecipe(lift, LCX, LCY, R, theme.fieldGlow, 0.5);
    // the texture's opaque 18% core, in ADD-equivalent form over the bg:
    // bg + fieldGlow×0.5 (sprite alpha), filled opaque
    {
      const bg = theme.bg;
      const fg = theme.fieldGlow;
      const mix = (sh: number) => Math.min(255, Math.round(((bg >> sh) & 0xff) + ((fg >> sh) & 0xff) * 0.5));
      lift.fillStyle(Phaser.Display.Color.GetColor(mix(16), mix(8), mix(0)), 1);
      lift.fillCircle(LCX, LCY, R * 0.18);
    }
    this.statics.push(lift);

    this.drawAmbience(theme);
    const g = this.add.graphics().setDepth(1);
    this.statics.push(g);

    // path: wide dark band, thin luminous centre, chevrons for direction
    const wps = this.level.map.waypoints;
    g.lineStyle(PATH_WIDTH, theme.path, 1);
    g.beginPath();
    g.moveTo(wps[0].x, wps[0].y);
    for (let i = 1; i < wps.length; i++) g.lineTo(wps[i].x, wps[i].y);
    g.strokePath();
    g.lineStyle(PATH_WIDTH - 10, theme.pathInner, 1);
    g.strokePath();
    g.lineStyle(2, C.line, 0.8);
    g.strokePath();

    for (let d = 120; d < this.path.len - 40; d += 190) {
      const p = this.path.posAt(d);
      const p2 = this.path.posAt(d + 14);
      const ang = Math.atan2(p2.y - p.y, p2.x - p.x);
      const chev = this.add.graphics().setDepth(2);
      this.statics.push(chev);
      chev.fillStyle(C.muted, 0.28);
      chev.beginPath();
      chev.moveTo(p.x - Math.cos(ang) * 7 - Math.sin(ang) * 7, p.y - Math.sin(ang) * 7 + Math.cos(ang) * 7);
      chev.lineTo(p.x + Math.cos(ang) * 9, p.y + Math.sin(ang) * 9);
      chev.lineTo(p.x - Math.cos(ang) * 7 + Math.sin(ang) * 7, p.y - Math.sin(ang) * 7 - Math.cos(ang) * 7);
      chev.closePath();
      chev.fillPath();
    }

    // murk entrance markers (images — stay live; see bakeStatics)
    this.add.image(wps[0].x, 30, 'glow').setScale(0.5).setTint(0xff5f7a).setAlpha(0.5).setBlendMode(Phaser.BlendModes.ADD).setDepth(2);
    for (const f of this.level.map.flyerSpawns) {
      const x = Phaser.Math.Clamp(f.x, 26, GAME_W - 26);
      const y = Phaser.Math.Clamp(f.y, 26, GAME_H - 26);
      this.add.image(x, y, 'enemy_flyer').setScale(0.16).setAlpha(0.5).setDepth(2);
    }
    this.flyerLanes = this.add.graphics().setDepth(2);
    this.drawFlyerLanes();

    // the Lantern — glow radius is rune-driven (70% at zero runes → 100% at 3)
    const lantern = this.level.map.lantern;
    this.lanternGlow = this.add
      .image(lantern.x, lantern.y, 'glow')
      .setTint(C.amber)
      .setAlpha(0.5)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(8);
    this.add.image(lantern.x, lantern.y, 'lantern').setScale(0.5).setDepth(9);
    this.updateLanternGlow();
    // press-and-hold rune peek button (dimmed until the first rune)
    this.runeButton = new RuneButton(this);
    this.runeButton.setRunes(
      [...this.runes]
        .map((id) => RUNES.find((r) => r.id === id))
        .filter((r): r is RuneDef => Boolean(r)),
    );
    // statics are all collected by now — composite them once (see bakeStatics)
    this.bakeStatics();
  }

  /** Ambience theme: per campaign level; daily/endless play the bestiary map's theme. */
  private levelTheme(): LevelTheme {
    return THEMES[(this.mode === 'level' ? this.level : BESTIARY_LEVEL).id] ?? THEMES[BESTIARY_LEVEL.id];
  }

  /** Stars / moon / treeline / drifting motes / vignette — all behind the playfield. */
  private drawAmbience(theme: LevelTheme): void {
    // star field: one batched graphics, deterministic per level
    if (theme.stars > 0) {
      const rng = new Rng(this.level.id * 997 + 17);
      const starG = this.add.graphics().setDepth(0);
      this.statics.push(starG);
      for (let i = 0; i < theme.stars; i++) {
        starG.fillStyle(0xeef2ff, rng.float(0.12, 0.55));
        starG.fillCircle(rng.float(14, GAME_W - 14), rng.float(30, 760), rng.float(0.8, 1.9));
      }
    }

    // the woodlands mark: conifer silhouettes crowding the top band —
    // single batched graphics, deterministic per level, forest in front of
    // the sky but behind the path (depth 0 vs path's 1). The woods style
    // (theme or ?woods= override) wraps the frame: side columns and/or a
    // bottom floor strip, all behind the playfield.
    if (theme.trees) {
      const { color, count, band } = theme.trees;
      const style = DEBUG.woods ?? theme.trees.style ?? null;
      const rng = new Rng(this.level.id * 577 + 3);
      const tg = this.add.graphics().setDepth(0);
      this.statics.push(tg);
      const conifer = (x: number, baseY: number, h: number, a: number) => {
        const w = h * rng.float(0.42, 0.58);
        tg.fillStyle(color, a);
        tg.fillTriangle(x - w, baseY, x + w, baseY, x, baseY - h);
        tg.fillTriangle(x - w * 0.68, baseY - h * 0.36, x + w * 0.68, baseY - h * 0.36, x, baseY - h * 1.26);
      };
      for (let i = 0; i < count; i++) {
        conifer(rng.float(-12, GAME_W + 12), rng.float(10, band), rng.float(34, 78), rng.float(0.5, 0.8));
      }

      if (style === 'frame') {
        // balanced frame: regular side columns + a bottom strip
        const sr = new Rng(this.level.id * 577 + 91);
        for (let i = 0; i < count * 0.5; i++) {
          const h = sr.float(30, 70);
          conifer(sr.float(-8, 58), sr.float(70, GAME_H - 60), h, sr.float(0.5, 0.78));
          conifer(GAME_W - sr.float(-8, 58), sr.float(70, GAME_H - 60), h, sr.float(0.5, 0.78));
        }
        const fr = new Rng(this.level.id * 577 + 157);
        for (let i = 0; i < count * 0.7; i++) {
          conifer(fr.float(0, GAME_W), GAME_H + 10, fr.float(40, 90), fr.float(0.5, 0.78));
        }
      } else if (style === 'encroach') {
        // organic: clusters of large fingers pinch in from the edges, sparse floor
        const sr = new Rng(this.level.id * 577 + 211);
        for (let i = 0; i < count * 0.35; i++) {
          const h = sr.float(50, 110);
          const y = sr.float(90, GAME_H - 120);
          // 2-3 tree cluster reaching inward
          const cx = sr.float(20, 128);
          for (let k = 0; k < sr.int(2, 3); k++) {
            conifer(cx + sr.float(-22, 22), y + sr.float(-16, 16), h * sr.float(0.7, 1), sr.float(0.45, 0.7));
            conifer(GAME_W - cx + sr.float(-22, 22), y + sr.float(-16, 16), h * sr.float(0.7, 1), sr.float(0.45, 0.7));
          }
        }
        const fr = new Rng(this.level.id * 577 + 307);
        for (let i = 0; i < count * 0.35; i++) {
          const h = fr.float(30, 60);
          conifer(fr.float(0, GAME_W), GAME_H + 8, h, fr.float(0.45, 0.7));
          if (fr.float(0, 1) < 0.18) conifer(fr.float(60, GAME_W - 60), GAME_H + 8, 92, 0.6); // rare sentinel
        }
      } else if (style === 'surround') {
        // canopy wall: packed two-tone rows on sides + floor
        const sr = new Rng(this.level.id * 577 + 401);
        for (let y = 80; y < GAME_H - 50; y += sr.float(24, 34)) {
          const h = sr.float(40, 85);
          // back row lighter + offset outward, front row darker — parallax depth
          conifer(sr.float(-20, 34), y + sr.float(-8, 8), h * 0.85, 0.42);
          conifer(sr.float(26, 64), y + sr.float(-6, 6), h, sr.float(0.52, 0.75));
          conifer(GAME_W - sr.float(-20, 34), y + sr.float(-8, 8), h * 0.85, 0.42);
          conifer(GAME_W - sr.float(26, 64), y + sr.float(-6, 6), h, sr.float(0.52, 0.75));
        }
        const fr = new Rng(this.level.id * 577 + 523);
        for (let x = -10; x < GAME_W + 10; x += fr.float(20, 30)) {
          const h = fr.float(55, 100);
          conifer(x + fr.float(-8, 8), GAME_H + 14, h * 0.8, 0.42); // back
          conifer(x + fr.float(-6, 6), GAME_H + 6, h, fr.float(0.52, 0.75)); // front
        }
      }
    }

    // pale moon disc with a soft halo and a subtle bite (the ADD halo is an
    // image — stays live; only the Graphics disc bakes)
    if (theme.moon) {
      const m = theme.moon;
      this.add
        .image(m.x, m.y, 'glow')
        .setScale(m.r / 60)
        .setTint(0xbfd0ff)
        .setAlpha(m.alpha * 0.55)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setDepth(0);
      const disc = this.add.graphics().setDepth(0);
      this.statics.push(disc);
      disc.fillStyle(0xdde6ff, m.alpha);
      disc.fillCircle(m.x, m.y, m.r);
      disc.fillStyle(theme.bg, m.alpha * 0.35);
      disc.fillCircle(m.x + m.r * 0.42, m.y - m.r * 0.3, m.r * 0.75);
    }

    // drifting motes — fireflies on calm levels, murk ash rising on the
    // deep one. Additive but few and small (mobile fill-rate rule, §3).
    if (theme.motes) {
      const { color, count, rise } = theme.motes;
      for (let i = 0; i < count; i++) {
        const m = this.add
          .image(
            Phaser.Math.Between(30, GAME_W - 30),
            rise ? Phaser.Math.Between(560, 1180) : Phaser.Math.Between(240, 900),
            'dot',
          )
          .setTint(color)
          .setScale(Phaser.Math.FloatBetween(0.04, 0.1))
          .setAlpha(Phaser.Math.FloatBetween(0.12, 0.32))
          .setBlendMode(Phaser.BlendModes.ADD)
          .setDepth(2);
        this.tweens.add({
          targets: m,
          y: rise ? m.y - Phaser.Math.Between(500, 900) : m.y - Phaser.Math.Between(60, 140),
          x: m.x + Phaser.Math.Between(-50, 50),
          alpha: rise ? 0.28 : 0,
          duration: Phaser.Math.Between(rise ? 9000 : 4000, rise ? 16000 : 8000),
          repeat: -1,
          delay: Phaser.Math.Between(0, 6000),
          onRepeat: () => {
            m.setX(Phaser.Math.Between(30, GAME_W - 30));
            m.setY(rise ? Phaser.Math.Between(700, 1180) : Phaser.Math.Between(400, 950));
          },
        });
      }
    }

    // vignette: the 'glow' ring recipe in black at each corner — Graphics
    // only, baked into the transparent depth-7 texture (see bakeStatics)
    if (theme.vignette > 0) {
      const corners: [number, number][] = [[0, 0], [GAME_W, 0], [0, GAME_H], [GAME_W, GAME_H]];
      for (const [x, y] of corners) {
        const vg = this.add.graphics();
        glowRingRecipe(vg, x, y, (128 * 2) / 2 * 6, 0x000000, theme.vignette);
        vg.fillStyle(0x000000, theme.vignette); // the texture's opaque core
        vg.fillCircle(x, y, (128 * 2) / 2 * 6 * 0.18);
        this.vignetteStatics.push(vg);
      }
    }
  }

  /** Composite the collected static GRAPHICS once into baked textures,
   * then destroy the originals: ~25 Graphics objects that Phaser
   * re-tessellated and re-blended EVERY frame become two quads (opaque
   * background at depth −1, black vignette at depth 7).
   *
   * Probe-verified rules on Phaser 3.90 (see bake-shot diffs):
   *  - The background RT is pre-filled with the bg colour, so every
   *    normal-blend Graphics draw composites EXACTLY as it did against the
   *    camera background.
   *  - Sprite-batched draws (Images: the ADD glows, flyer markers) corrupt
   *    the RT's alpha channel, and any ADD draw kills the whole RT — those
   *    few objects stay live.
   *  - Black content in a TRANSPARENT RT is alpha-exact (rgb 0 survives the
   *    double application), so the vignette corners bake as ring-Graphics.
   *
   * Deliberately NOT collected: lantern glow pulse, ambience motes, flyer
   * lanes (prep toggle), tiles, aura rings. */
  private bakeStatics(): void {
    if (this.statics.length) {
      const theme = this.levelTheme();
      const rt = this.add.renderTexture(0, 0, GAME_W, GAME_H).setOrigin(0).setDepth(-1);
      rt.fill(theme.bg, 1);
      for (const o of this.statics) rt.draw(o);
      for (const o of this.statics) o.destroy();
      this.statics = [];
    }
    if (this.vignetteStatics.length) {
      // black content in a transparent RT: out = below×(1−a) — identical to
      // the live black images it replaces, at the same depth
      const rt = this.add.renderTexture(0, 0, GAME_W, GAME_H).setOrigin(0).setDepth(7);
      for (const o of this.vignetteStatics) rt.draw(o);
      for (const o of this.vignetteStatics) o.destroy();
      this.vignetteStatics = [];
    }
  }

  /** Glow scale multiplier: 0.7 with no runes, 1.0 from 3 runes on (linear). */
  private glowMult(): number {
    return 0.7 + 0.3 * Math.min(this.runes.size / 3, 1);
  }

  private updateLanternGlow(): void {
    if (!this.lanternGlow) return;
    const m = this.glowMult();
    this.lanternTween?.remove();
    this.lanternGlow.setScale(1.7 * m).setAlpha(0.5);
    this.lanternTween = this.tweens.add({
      targets: this.lanternGlow,
      scale: 2.1 * m,
      alpha: 0.75,
      duration: 2000,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
  }

  /** Dashed lanes from each flyer spawn to the Lantern — in the flyers'
   * own palette colour (bright enough to read on any theme; the first
   * cut used theme.pathInner and was effectively invisible on dark
   * boards), each ending in a chevron that points at the Lantern, with a
   * gentle pulse while shown. Drawn once per run, toggled by the strip. */
  private drawFlyerLanes(): void {
    const g = this.flyerLanes;
    if (!g) return;
    g.clear();
    const to = this.level.map.lantern;
    g.lineStyle(2.5, ENEMY_COLOR.flyer, 0.55);
    g.fillStyle(ENEMY_COLOR.flyer, 0.75);
    for (const f of this.level.map.flyerSpawns) {
      const x = Phaser.Math.Clamp(f.x, 26, GAME_W - 26);
      const y = Phaser.Math.Clamp(f.y, 26, GAME_H - 26);
      const len = Phaser.Math.Distance.Between(x, y, to.x, to.y);
      const ang = Math.atan2(to.y - y, to.x - x);
      for (let d = 20; d < len - 34; d += 26) {
        const seg = Math.min(12, len - 34 - d);
        g.beginPath();
        g.moveTo(x + Math.cos(ang) * d, y + Math.sin(ang) * d);
        g.lineTo(x + Math.cos(ang) * (d + seg), y + Math.sin(ang) * (d + seg));
        g.strokePath();
      }
      // incoming chevron at the Lantern end — unmissable direction cue
      const cx = x + Math.cos(ang) * (len - 26);
      const cy = y + Math.sin(ang) * (len - 26);
      const px = Math.cos(ang + Math.PI / 2);
      const py = Math.sin(ang + Math.PI / 2);
      g.beginPath();
      g.moveTo(x + Math.cos(ang) * (len - 12), y + Math.sin(ang) * (len - 12));
      g.lineTo(cx + px * 10, cy + py * 10);
      g.lineTo(cx - px * 10, cy - py * 10);
      g.closePath();
      g.fillPath();
    }
    // gentle pulse while shown (single-object tween — cheap)
    this.tweens.add({
      targets: g,
      alpha: { from: 0.55, to: 1 },
      duration: 1100,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
  }

  /** Lanes show ONLY during prep when the upcoming wave has flyers. */
  private updateFlyerLanes(): void {
    if (!this.flyerLanes) return;
    const show =
      this.waveStripMode === 'next' &&
      (this.nextWaveGroups ?? []).some((grp) => grp.kind === 'flyer');
    this.flyerLanes.setVisible(show);
  }

  private createFx(): void {
    this.fx = new Fx(this);
  }

  private createTiles(): void {
    this.level.map.tiles.forEach((t, i) => {
      const sprite = this.add.image(t.x, t.y, 'tile').setScale(0.5).setDepth(3).setAlpha(0.9);
      const zone = this.add.zone(t.x, t.y, 64, 64).setInteractive({ useHandCursor: true }).setDepth(13);
      zone.on('pointerup', () => {
        if (this.paused || this.phase === 'over') return;
        audio.play('tap');
        this.selectTile(i);
        if (this.tiles[i].tower) this.sheet.showTower(i);
        else this.sheet.showBuild(i);
      });
      this.tiles.push({ x: t.x, y: t.y, sprite, zone, tower: null });
    });
  }

  selectTile(i: number): void {
    this.selectedTile = i;
    this.selRing.clear();
    this.rangeRing.setVisible(false);
    if (i < 0) return;
    const t = this.tiles[i];
    this.selRing.lineStyle(3, C.amber, 0.95);
    this.selRing.strokeRoundedRect(t.x - 30, t.y - 30, 60, 60, 12);
    const tower = t.tower;
    if (tower) {
      this.rangeRing
        .setPosition(tower.x, tower.y)
        .setRadius(tower.range)
        .setStrokeStyle(2, tower.kind === 'halo' ? 0x9b8cff : 0xeef2ff, 0.3)
        .setVisible(true);
    }
  }

  // ============================================================
  // HUD
  // ============================================================
  private createHud(): void {
    this.hud = new Hud(this, {
      onStart: () => {
        if (this.phase === 'ready') this.startWave();
      },
      onSpeedToggle: () => {
        this.speedMult = this.speedMult === 1 ? 2 : 1;
        this.hud.setSpeedLabel(`×${this.speedMult}`);
      },
      onPause: () => this.openPause(),
    });
  }

  private refreshHud(force = false): void {
    if (!force && this.gameTime - this.lastHud < 150) return;
    this.lastHud = this.gameTime;
    const total = this.level.waves.length;
    const waveNum = Math.max(1, this.waveIndex);
    const waveLabel =
      this.endlessUnlocked || this.waveIndex > total
        ? tN('waveOnly', waveNum)
        : tN('waveOf', waveNum, total);
    this.hud.refreshTop(
      this.mode === 'daily' ? tN('waveDaily', waveNum) : waveLabel,
      this.gold,
      this.hp,
      this.maxHp,
    );

    // green chevrons on towers whose next tier is currently affordable
    for (const t of this.towers) {
      const c = t.nextCost();
      t.setUpgradeAvailable(c !== null && this.gold >= c);
    }

    // start button: visible ONLY during prep — during waves the wave strip
    // owns the bottom area as a remaining-enemy tracker
    this.hud.setStartState(this.phase === 'ready', tN('startWave', this.waveIndex));

    // live updates: remaining counts during a wave, affordability in open sheets
    if (this.waveStripMode === 'remaining') this.updateStripCounts();
    if (this.sheet) this.sheet.refresh();

    this.hud.refreshBosses(
      this.enemies.filter((e) => e.alive && e.isBoss).map((b) => ({ hp: b.hp, maxHp: b.maxHp, rooted: b.core.rootUntil > this.gameTime })),
    );
  }

  private showBanner(text: string, color: string, hold = 900, fontSize = '30px'): void {
    this.banner?.destroy();
    this.banner = this.add
      .text(GAME_W / 2, 260, text, {
        fontFamily: FONT, fontSize, color, fontStyle: 'bold',
        align: 'center',
        wordWrap: { width: 600 }, // W4.0-5: long tips must wrap, not overflow
      })
      .setResolution(2)
      .setOrigin(0.5)
      .setDepth(55)
      .setAlpha(0);
    this.tweens.add({
      targets: this.banner,
      alpha: 1,
      y: 240,
      duration: 350,
      yoyo: true,
      hold,
      onComplete: () => this.banner?.destroy(),
    });
  }

  // ============================================================
  // Build / upgrade / sell
  // ============================================================
  buildCost(kind: TowerKind): number {
    return towerBuildCost(kind, this.runes);
  }

  towerAt(tileIndex: number): Tower | null {
    return this.tiles[tileIndex]?.tower ?? null;
  }

  buildTower(tileIndex: number, kind: TowerKind): void {
    const tile = this.tiles[tileIndex];
    if (!tile || tile.tower) return;
    if (!this.level.towers.includes(kind)) return; // level roster guard
    const cost = this.buildCost(kind);
    if (this.gold < cost) {
      audio.play('deny');
      return;
    }
    this.gold -= cost;
    const t = new Tower(this, kind, tileIndex, tile.x, tile.y, cost);
    tile.tower = t;
    tile.sprite.setAlpha(0.35);
    this.towers.push(t);
    audio.play('build');
    this.fx.burst('amber', 6, tile.x, tile.y);
  }

  upgradeTower(tower: Tower): void {
    const cost = tower.nextCost();
    if (cost === null || this.gold < cost) {
      audio.play('deny');
      return;
    }
    this.gold -= cost;
    tower.invested += cost;
    tower.upgrade();
    audio.play('upgrade');
    this.fx.burst('white', 10, tower.x, tower.y);
    if (this.selectedTile === tower.tileIndex) this.selectTile(tower.tileIndex);
    this.refreshHud(true); // chevrons update instantly after spending
  }

  sellTower(tower: Tower): void {
    this.gold += tower.sellValue;
    const tile = this.tiles[tower.tileIndex];
    tile.tower = null;
    tile.sprite.setAlpha(0.9);
    this.towers = this.towers.filter((t) => t !== tower);
    tower.destroy();
    audio.play('sell');
    this.refreshHud(true);
  }

  // ============================================================
  // Waves
  // ============================================================
  startWave(): void {
    if (this.phase !== 'ready') return;
    this.phase = 'wave';
    this.waveTime = 0;
    this.spawnQueue = [];
    // use the composition previewed at wave end (keeps preview == reality,
    // and keeps the seeded RNG single-consumption on endless waves)
    const groups = this.nextWaveGroups ?? waveGroups(this.level, this.waveIndex, this.waveRng);
    this.currentWaveGroups = groups;
    this.nextWaveGroups = null;
    this.setStrip('remaining'); // strip slides down, chips become a live tracker
    this.spawnQueue = buildSpawnQueue(groups);
    const bossKind = this.spawnQueue.find((s) => BOSS_LIKES.has(s.kind))?.kind;
    if (bossKind) {
      audio.play('boss');
      this.showBanner(t(bossKind === 'heartwood' ? 'heartwoodStirs' : 'bossStirs'), CSS.red);
      this.cameras.main.shake(250, 0.004);
    } else {
      audio.play('wave');
    }
    this.refreshHud(true);
  }

  private endWave(): void {
    const cleared = this.waveIndex;
    const bonus = waveBonus(cleared);
    this.gold += bonus;
    this.earned += bonus;
    this.floatText(`+${bonus} ${t('goldUnit')}`, CSS.amber, this.level.map.lantern.x, this.level.map.lantern.y - 90);
    this.waveIndex = cleared + 1;
    this.phase = 'ready';

    if (!this.endlessUnlocked && cleared >= this.level.waves.length) {
      this.setStrip(null);
      this.victory();
      return; // no nextWaveGroups compute here — the endless-continue path
      // computes it exactly once (RNG consumed once per wave, invariant holds)
    }
    this.nextWaveGroups = waveGroups(this.level, this.waveIndex, this.waveRng);
    if (this.level.runes && cleared % 5 === 0 && !this.demo) {
      this.phase = 'rune';
      this.setStrip(null); // hidden while the rune choice is pending
      this.activeRuneOverlay = new RuneOverlay(this, this.pickRunes(), (rune) => {
        this.applyRune(rune.id);
        this.phase = 'ready';
        this.setStrip('next'); // strip reappears only after the rune is chosen
        this.activeRuneOverlay = undefined;
        this.refreshHud(true);
      });
    } else {
      this.setStrip('next');
    }
    if (this.demo) {
      this.time.delayedCall(1000, () => {
        if (this.phase === 'ready') this.startWave();
      });
    }
    this.refreshHud(true);
  }

  // ============================================================
  // Next-wave preview (shown between waves, hidden on start)
  // ============================================================
  // ============================================================
  // Wave strip: upcoming mix during prep (upper position, never covers
  // build tiles), remaining-enemy tracker once the wave starts (bottom
  // position — replaces the old "murk counter" on the start button).
  // ============================================================
  private static mergeKinds(groups: SpawnGroup[]): { kind: EnemyKind; count: number }[] {
    const totals = new Map<EnemyKind, number>();
    for (const g of groups) totals.set(g.kind, (totals.get(g.kind) ?? 0) + g.count);
    return [...totals.entries()].map(([kind, count]) => ({ kind, count }));
  }

  private setStrip(mode: 'next' | 'remaining' | null): void {
    this.waveStripMode = mode;
    this.updateFlyerLanes();
    if (mode === null) {
      this.hud.stripHide();
      return;
    }
    const groups = mode === 'next' ? (this.nextWaveGroups ?? []) : (this.currentWaveGroups ?? []);
    const merged = GameScene.mergeKinds(groups);
    if (merged.length === 0) {
      this.waveStripMode = null;
      this.hud.stripHide();
      return;
    }
    this.hud.stripShow(this.waveIndex, merged, mode, this.phase !== 'wave');
    if (mode === 'remaining') this.updateStripCounts();
  }

  /** Live remaining = alive on field + still queued. */
  private updateStripCounts(): void {
    const counts = new Map<EnemyKind, number>();
    for (const e of this.enemies) if (e.alive) counts.set(e.kind, (counts.get(e.kind) ?? 0) + 1);
    for (const s of this.spawnQueue) counts.set(s.kind, (counts.get(s.kind) ?? 0) + 1);
    this.hud.stripCounts(counts);
  }

  /** Choices currently offered by the rune overlay (smoke contract). */
  pendingRuneChoices: RuneDef[] = [];

  private pickRunes(): typeof RUNES {
    const pool = runeOfferPool(this.level, this.runes);
    this.pendingRuneChoices = this.runeRng.shuffle([...pool]).slice(0, 3);
    return this.pendingRuneChoices;
  }

  private applyRune(id: RuneId): void {
    this.runes.add(id);
    const def = RUNES.find((r) => r.id === id);
    // instants live in the table (M2) — shared deltas (src/sim/waves.ts)
    const inst = runeInstants(id);
    if (inst.maxHpPlus > 0) this.maxHp += inst.maxHpPlus;
    if (inst.healToFull) this.hp = this.maxHp;
    this.gold += inst.gold;
    this.earned += inst.gold;
    // any range-affecting rune must redraw aura rings
    const eff = def?.effect;
    if (eff?.kind === 'stat' && (eff.stat === 'range' || eff.stat === 'groveRange')) {
      for (const t of this.towers) t.refreshAura();
    }
    // the lantern brightens and the peek button takes the new rune
    this.updateLanternGlow();
    if (def) this.runeButton?.addRune(def);
    this.floatText(t('runeClaimed'), CSS.violet, GAME_W / 2, 300);
  }

  // ============================================================
  // Combat plumbing (called by towers)
  // ============================================================
  spawnBolt(tower: Tower, target: Enemy, dmg: number): void {
    const sprite = this.add
      .image(tower.x, tower.y - 14, 'spark')
      .setTint(0xffc24b)
      .setScale(0.34)
      .setDepth(30)
      .setBlendMode(Phaser.BlendModes.ADD);
    this.bolts.push({
      sprite, x: tower.x, y: tower.y - 14, target,
      dest: { x: target.x, y: target.y },
      speed: COMBAT.boltSpeed, dmg, color: 0xffc24b, owner: tower,
    });
    audio.play('shoot');
  }

  fireBeam(tower: Tower, target: Enemy): void {
    const g = beamGeom(tower.x, tower.y, target.x, target.y, tower.range);
    const width = beamWidth(tower.tier, this.runes);
    for (const e of beamHits(tower.x, tower.y, g.end.x, g.end.y, width, this.enemies)) {
      e.damage(tower.dmg);
    }
    const beamHeight = (COMBAT.beamHeightBase + tower.tier * COMBAT.beamHeightPerTier) * beamWidthMult(this.runes);
    this.fx.beam(tower.x, tower.y, g.ang, g.len, beamHeight);
    audio.play('beam');
  }

  fireShell(tower: Tower, target: Enemy): void {
    // lead the target ~ flight time
    const lead = COMBAT.shellLeadMs;
    const ahead = target.posAhead(lead);
    const sprite = this.add
      .image(tower.x, tower.y - 14, 'dot')
      .setTint(0xff8b4b)
      .setScale(0.4)
      .setDepth(30)
      .setBlendMode(Phaser.BlendModes.ADD);
    this.shells.push({
      sprite,
      from: { x: tower.x, y: tower.y - 14 },
      to: ahead,
      t: 0,
      dur: lead,
      dmg: tower.dmg,
      radius: tower.splash,
      color: 0xff8b4b,
    });
    audio.play('shoot');
  }

  auraPulse(tower: Tower): void {
    this.fx.shockwave(tower.x, tower.y, tower.range);
  }

  /** Product of every Wisp Grove's buff covering this tower — shared core
   * (src/sim/stats.ts); see there for the stacking rules. */
  groveBuffFor(tower: Tower): { dmg: number; rate: number } {
    return groveBuffCore(tower, this.towers, this.runes);
  }

  /** The Heartwood Murk calls runner packs from behind itself (Enemy.update
   * accumulates the timer on the game clock; summons consume the combat
   * variance stream — deterministic per seed, see DEV_NOTES §2). */
  /** Sprout a runner pack behind the Heartwood (Root & Sprout phase
   * crossing — shared drops via summonDropDists; rng is consumed inside
   * spawn, per runner, same as the sim). */
  summonPack(boss: Enemy, count: number): void {
    for (const d of summonDropDists(boss.dist, count)) {
      const e = new Enemy(this, 'runner', this.waveIndex, this.rng);
      e.dropAt(d);
      this.enemies.push(e);
    }
    this.fx.burst('violet', 12, boss.x, boss.y - 26);
    this.fx.shockwave(boss.x, boss.y, 96); // the root ring — burst window opens
    audio.play('summon');
  }

  flashWhite(e: Enemy): void {
    e.flashWhite();
  }

  /** Heal indicator on an affected enemy — the healer itself is silent
   * (pass-through like flashWhite: visuals route through the scene). */
  healMotes(e: Enemy): void {
    this.fx.motes(2, e.x, e.y - 8);
  }

  killEnemy(e: Enemy): void {
    // claim, not `!e.alive`: the shared core already flipped `alive` by the
    // time a corpse reaches here (W4.0-6 — the old guard skipped bounty,
    // fx, sound AND destroy, leaving white ghosts and a starved economy)
    if (!e.claimKill()) return;
    e.alive = false;
    this.kills++;
    const bounty = killBounty(e.core, this.runes);
    this.gold += bounty;
    this.earned += bounty;
    this.floatText(`+${bounty}`, CSS.amber, e.x, e.y - 14, 15);
    const fxKey: 'magenta' | 'pink' | 'violet' | 'red' =
      e.kind === 'shielded' ? 'magenta' : e.kind === 'healer' ? 'pink' : e.kind === 'flyer' ? 'violet' : 'red';
    this.fx.burst(fxKey, e.isBoss ? 26 : 8, e.x, e.y);
    if (e.isBoss) {
      this.fx.burst('white', 16, e.x, e.y);
      this.cameras.main.shake(300, 0.006);
    }
    audio.play('kill');
    e.destroy();
  }

  private leak(e: Enemy): void {
    this.leaks++;
    this.hp = leakDamage(this.hp, e.kind);
    audio.play('leak');
    this.cameras.main.flash(180, 60, 10, 20);
    this.refreshHud(true);
    // the lantern drinks the murk: shrink+fade into the flame, then remove
    const spr = e.sprite;
    this.fx.burst('red', 6, this.level.map.lantern.x, this.level.map.lantern.y);
    this.fx.absorb(spr);
    if (this.hp <= 0) this.defeat();
  }

  // ============================================================
  // Main loop
  // ============================================================
  override update(_time: number, delta: number): void {
    if (this.paused || this.phase === 'over' || this.phase === 'won' || this.phase === 'rune') return;
    const dt = Math.min(delta, 100) * this.speedMult;
    this.gameTime += dt;

    if (this.phase === 'wave') {
      this.waveTime += dt;
      while (this.spawnQueue.length && this.spawnQueue[0].at <= this.waveTime) {
        const s = this.spawnQueue.shift()!;
        this.enemies.push(new Enemy(this, s.kind, this.waveIndex, this.rng));
      }
    }

    // enemies
    for (const e of this.enemies) {
      if (!e.alive) continue;
      if (e.update(dt) === 'leak') this.leak(e);
    }
    this.enemies = this.enemies.filter((e) => e.alive);

    // towers
    for (const t of this.towers) t.update(dt, this.enemies);

    // bolts
    for (const b of this.bolts) {
      if (stepBoltCore(b, dt)) {
        // arrive
        if (b.target && b.target.alive) {
          b.target.damage(b.dmg);
          if (hasChains(this.runes)) this.chain(b.target, b.dmg);
        }
        this.fx.burst('amber', 3, b.dest.x, b.dest.y);
        b.sprite.destroy();
        b.speed = -1; // mark dead
      } else {
        b.sprite.setPosition(b.x, b.y);
      }
    }
    this.bolts = this.bolts.filter((b) => b.speed > 0);

    // shells
    for (const s of this.shells) {
      const p = stepShellCore(s, dt, s.dur);
      s.sprite.setPosition(
        Phaser.Math.Linear(s.from.x, s.to.x, p),
        Phaser.Math.Linear(s.from.y, s.to.y, p) - Math.sin(p * Math.PI) * COMBAT.shellArc,
      );
      if (p >= 1) {
        this.explode(s.to.x, s.to.y, s.radius, s.dmg);
        s.sprite.destroy();
        s.dur = -1;
      }
    }
    this.shells = this.shells.filter((s) => s.dur > 0);

    // hp bars (single graphics pass — cheap)
    this.drawHpBars();

    // wave complete?
    if (this.phase === 'wave' && this.spawnQueue.length === 0 && this.enemies.length === 0) {
      this.endWave();
    }
    this.refreshHud();
  }

  private drawHpBars(): void {
    const g = (this.hpBars ??= this.add.graphics().setDepth(25));
    g.clear();
    for (const e of this.enemies) {
      if (e.alive && e.hp < e.maxHp && !e.isBoss) {
        const w = e.kind === 'swarm' ? 20 : 28;
        const f = Phaser.Math.Clamp(e.hp / e.maxHp, 0, 1);
        g.fillStyle(0x0d1226, 0.9);
        g.fillRect(e.x - w / 2, e.y - 30, w, 4);
        g.fillStyle(f > 0.4 ? 0xff8ea0 : 0xff3b5c, 1);
        g.fillRect(e.x - w / 2, e.y - 30, w * f, 4);
      }
    }
  }
  private hpBars?: Phaser.GameObjects.Graphics;

  private explode(x: number, y: number, radius: number, dmg: number): void {
    // splash hits — halved by rooted Heartwood bark (damageEnemyCore)
    for (const e of splashHits(x, y, radius, this.enemies)) e.damage(dmg, true, true);
    this.fx.explosion(x, y, radius);
    audio.play('splash');
  }

  private chain(victim: Enemy, dmg: number): void {
    for (const e of chainTargets(victim, this.enemies, COMBAT.chainTargets, COMBAT.chainRadius)) {
      // spark visual
      this.fx.sparkLine(victim.x, victim.y, e.x, e.y);
      e.damage(dmg * COMBAT.chainDamageMult);
    }
  }

  private floatText(text: string, color: string, x: number, y: number, size = 17): void {
    this.fx.floatText(text, color, x, y, size);
  }

  // ============================================================
  // Pause / end
  // ============================================================
  openPause(): void {
    if (this.paused || this.phase === 'over' || this.phase === 'won') return;
    this.paused = true;
    showPause(this);
  }

  resume(): void {
    this.paused = false;
  }

  restartRun(): void {
    this.scene.restart({ mode: this.mode, levelId: this.levelId });
  }

  private defeat(): void {
    if (this.phase === 'over') return;
    this.phase = 'over';
    this.setStrip(null);
    audio.play('defeat');
    const save = loadSave();
    const cleared = this.waveIndex - 1;
    const patch: Parameters<typeof patchSave>[0] = {
      runs: save.runs + 1,
      totalKills: save.totalKills + this.kills,
      bestWave: Math.max(save.bestWave, cleared),
    };
    if (this.mode === 'daily') patch.daily = { date: todayDailySeed(), wave: Math.max(save.daily?.date === todayDailySeed() ? save.daily.wave : 0, cleared) };
    patchSave(patch);
    showEnd(this, false, { wave: cleared, kills: this.kills, leaks: this.leaks, earned: this.earned }, {
      retry: () => this.scene.restart({ mode: this.mode, levelId: this.levelId }),
      menu: () => this.scene.start('Menu'),
    });
  }

  private victory(): void {
    this.phase = 'won';
    this.setStrip(null);
    audio.play('victory');
    const total = this.level.waves.length;
    const stars = this.leaks === 0 ? 3 : this.leaks <= 3 ? 2 : 1;
    const save = loadSave();
    patchSave({
      runs: save.runs + 1,
      wins: save.wins + 1,
      wonOnce: true,
      totalKills: save.totalKills + this.kills,
      bestWave: Math.max(save.bestWave, total),
      levelStars: { ...save.levelStars, [this.level.id]: Math.max(save.levelStars[this.level.id] ?? 0, stars) },
      daily: this.mode === 'daily' ? { date: todayDailySeed(), wave: total } : save.daily,
    });
    // campaign flow: the next level is the primary CTA; Endless is offered
    // only after the FINAL level (and on the daily's table-clear)
    const nextLevel = this.mode === 'level' && this.levelId < LEVELS.length ? LEVELS[this.levelId] : null;
    showEnd(this, true, { wave: total, kills: this.kills, leaks: this.leaks, earned: this.earned }, {
      retry: () => this.scene.restart({ mode: this.mode, levelId: this.levelId }),
      menu: () => this.scene.start('Menu'),
      ...(nextLevel
        ? { next: { label: `${t('next')} · ${t('lv')}${nextLevel.id} — ${levelName(nextLevel.id)}`, go: () => this.scene.restart({ mode: 'level', levelId: nextLevel.id }) } }
        : {}),
      ...(!nextLevel
        ? {
            endless: () => {
              this.endlessUnlocked = true;
              this.phase = 'ready';
              this.nextWaveGroups = waveGroups(this.level, this.waveIndex, this.waveRng);
              this.setStrip('next');
              this.refreshHud(true);
            },
          }
        : {}),
    });
  }
}

