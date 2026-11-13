// Procedural WebAudio engine — zero audio assets.
// iOS rules honoured (research §5.1): AudioContext is created/resumed inside a
// real gesture handler, simultaneous voices are capped, every cue is throttled.
// Background music: per-biome procedural tracks (config MUSIC), scheduler below.
import { MUSIC, MusicDef } from './config';

type Wave = OscillatorType;

interface ToneOpts {
  freq: number;
  to?: number;
  dur: number;
  type?: Wave;
  vol?: number;
  delay?: number;
  filter?: number;
}

class AudioSys {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private voices = 0;
  private lastPlay: Record<string, number> = {};
  // leak is throttled like every other combat voice (250ms): unthrottled, a
  // leak train stacked one 110→70Hz sawtooth sweep per leaking foe — stacked
  // buzzy bursts at wave-end that read as "electrical distortion" (2026-11-09).
  private throttles: Record<string, number> = {
    shoot: 55, hit: 70, kill: 90, beam: 120, splash: 90, summon: 250, aura: 950, leak: 250,
  };
  private auraAlt = false; // halo growl: alternate the two tonalities per pulse
  muted = false;
  private ambientOn = false;
  // --- background music (per-biome tracks from config MUSIC) ---
  /** Current track id. Default = the operator-locked woodlands pick; menus
   *  and levels call setMusic() from their biome, ?bg= overrides it. */
  track = 'woodlands';
  private def: MusicDef | null = null;
  private fadeToken = 0;
  // --- scheduler state (audio-clock lookahead pattern) ---
  private schedTimer: ReturnType<typeof setInterval> | null = null;
  private schedVoices = 0; // separate lane: never starves the 14 combat voices
  private cursor = 0; // next grid time on the audio clock (s)
  private gridIdx = 0; // musical position: 8th index within the 4-bar loop
  private seed = 1; // LCG for ±humanization (stable across runs)
  private amb: GainNode | null = null;
  private sendIn: GainNode | null = null;

  constructor() {
    // Android audio-path hygiene (phantom "electrical distortion" report
    // 2026-11-09): a backgrounded PWA keeps the context — and the ambient pad
    // — rendering, and Android route changes / driver excursions can leave
    // the output path crackling until something resets it. Suspending on
    // hide and resuming on return forces a clean pipeline restart every time
    // the game is backgrounded (also stops the pad while hidden = battery).
    // Only an already-unlocked context is touched, so the gesture rule is
    // intact; a refused resume (iOS interruption edge) is healed by the next
    // unlock() — every button press calls it.
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) this.suspend();
      else this.resume();
    });
  }

  get unlocked(): boolean {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  /** Must be called synchronously from a real pointer/touch handler. */
  unlock(): void {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.5;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state !== 'running') void this.ctx.resume();
    this.startAmbient();
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(m ? 0 : 0.5, this.ctx.currentTime, 0.05);
    }
  }

  /** Hard audio stop (screen lock / wake-lock loss) — distinct from the mute
   *  toggle: no state is remembered, the next resume() restarts the graph. */
  suspend(): void {
    if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend();
  }

  resume(): void {
    if (this.ctx && this.ctx.state !== 'running') void this.ctx.resume();
  }

  private budget(): boolean {
    if (!this.ctx || this.muted) return false;
    return this.voices < 14; // iOS simultaneous-sound ceiling (pool of 14)
  }

  private tone(o: ToneOpts): void {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + (o.delay ?? 0) / 1000;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(o.freq, t0);
    if (o.to !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.to), t0 + o.dur);
    const v = o.vol ?? 0.2;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(v, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
    let node: AudioNode = g;
    osc.connect(g);
    if (o.filter) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = o.filter;
      g.connect(f);
      node = f;
    }
    node.connect(this.master);
    this.voices++;
    osc.onended = () => { this.voices--; };
    osc.start(t0);
    osc.stop(t0 + o.dur + 0.05);
  }

  private noise(dur: number, vol = 0.2, filter = 1200, delay = 0): void {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + delay / 1000;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(filter, t0);
    f.frequency.exponentialRampToValueAtTime(Math.max(60, filter * 0.25), t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    this.voices++;
    src.onended = () => { this.voices--; };
    src.start(t0);
  }

  /** Named cue with per-name throttling. */
  play(name: string): void {
    if (!this.ctx || this.muted) return;
    const now = this.ctx.currentTime;
    const min = this.throttles[name] ?? 0;
    if (min > 0) {
      const last = this.lastPlay[name] ?? -1e9;
      if (now - last < min / 1000) return;
      this.lastPlay[name] = now;
    }
    if (!this.budget()) return;
    switch (name) {
      case 'shoot': this.tone({ freq: 720, to: 240, dur: 0.08, type: 'square', vol: 0.06 }); break;
      case 'beam': this.tone({ freq: 1400, to: 300, dur: 0.18, type: 'sawtooth', vol: 0.09, filter: 2400 }); break;
      case 'splash': this.noise(0.25, 0.18, 700); this.tone({ freq: 120, to: 50, dur: 0.22, type: 'triangle', vol: 0.16 }); break;
      case 'hit': this.tone({ freq: 320, to: 180, dur: 0.05, type: 'triangle', vol: 0.05 }); break;
      case 'kill': this.tone({ freq: 300, to: 60, dur: 0.14, type: 'sine', vol: 0.12 }); break;
      case 'build': this.tone({ freq: 180, to: 120, dur: 0.12, type: 'triangle', vol: 0.2 }); this.tone({ freq: 520, dur: 0.05, vol: 0.08, delay: 30 }); break;
      case 'upgrade': this.tone({ freq: 260, dur: 0.08, vol: 0.15 }); this.tone({ freq: 390, dur: 0.08, vol: 0.15, delay: 70 }); this.tone({ freq: 520, dur: 0.1, vol: 0.15, delay: 140 }); break;
      case 'sell': this.tone({ freq: 420, to: 200, dur: 0.15, type: 'triangle', vol: 0.12 }); break;
      case 'deny': this.tone({ freq: 140, to: 100, dur: 0.1, type: 'square', vol: 0.08 }); break;
      case 'leak': this.tone({ freq: 110, to: 70, dur: 0.3, type: 'sawtooth', vol: 0.2, filter: 500 }); break;
      case 'wave': this.tone({ freq: 392, dur: 0.1, vol: 0.14 }); this.tone({ freq: 587, dur: 0.14, vol: 0.14, delay: 110 }); break;
      case 'rune': this.tone({ freq: 523, dur: 0.1, vol: 0.14 }); this.tone({ freq: 659, dur: 0.1, vol: 0.14, delay: 90 }); this.tone({ freq: 784, dur: 0.16, vol: 0.14, delay: 180 }); break;
      case 'boss': this.noise(0.8, 0.22, 240); this.tone({ freq: 60, to: 40, dur: 0.8, type: 'sine', vol: 0.24 }); break;
      case 'aura': {
        // Halo bite — the operator-picked voice (auditioned 2026-11-03): two
        // ALTERNATING lowpassed-saw tonalities loping with the ring pulse.
        // Design constraints learned the hard way: a pitched/sine voice here
        // either masks the 60–300Hz kill pops or reads as a notification —
        // the saw timbre stays distinct from both. Sound + shockwave fire
        // from the same Tower branch (1:1 sync); 950ms global throttle keeps
        // multiple halos to one heartbeat.
        this.auraAlt = !this.auraAlt;
        this.tone(this.auraAlt
          ? { freq: 84, to: 64, dur: 0.24, type: 'sawtooth', vol: 0.065, filter: 180 }
          : { freq: 68, to: 52, dur: 0.24, type: 'sawtooth', vol: 0.065, filter: 180 });
        break;
      }
      case 'summon': this.tone({ freq: 700, to: 900, dur: 0.12, type: 'sine', vol: 0.05 }); break; // heartwood pack call
      case 'victory':
        [392, 494, 587, 784].forEach((f, i) => this.tone({ freq: f, dur: 0.18, vol: 0.16, delay: i * 130 }));
        break;
      case 'defeat':
        [392, 311, 233, 175].forEach((f, i) => this.tone({ freq: f, dur: 0.22, vol: 0.16, delay: i * 160 }));
        break;
      case 'tap': this.tone({ freq: 500, to: 400, dur: 0.04, type: 'triangle', vol: 0.07 }); break;
    }
  }

  /** Background music entry — the per-biome track (config MUSIC). */
  private startAmbient(): void {
    if (this.ambientOn || !this.ctx || !this.master) return;
    this.ambientOn = true; // once-only guard lives HERE alone (see MEMORY gotcha)
    this.startMusic();
  }

  /** Select the background track (a config MUSIC key). Called before unlock:
   *  just records. While playing: crossfades to the new def. Same id: no-op. */
  setMusic(id: string): void {
    if (id === this.track) return;
    this.track = id;
    if (!this.ambientOn || !this.ctx || !this.amb) return;
    // crossfade: fade the bus out, then rebuild the graph on the new def
    const token = ++this.fadeToken;
    this.amb.gain.setTargetAtTime(0, this.ctx.currentTime, 0.25);
    setTimeout(() => {
      if (token !== this.fadeToken || !this.ctx) return;
      try { this.amb?.disconnect(); } catch { /* already gone */ }
      this.stopScheduler();
      this.startMusic();
    }, 750);
  }

  // ==================== background music (per-biome, procedural) ====================
  // Zero assets. A lookahead scheduler (tick every 300ms, plan 1.2s ahead on
  // the AUDIO clock — "two clocks" pattern) plays the track's 4-bar loop from
  // config MUSIC: soft triangle chords on the downbeat + a sparse sine
  // melody on an 8th-note grid, both feeding one shared echo bus (the "air").
  // Suspend-safe for free: ctx.currentTime freezes while hidden, so the
  // cursor stops; on resume it fast-forwards whole grid steps, in phase.
  // Muted = nothing is scheduled. Ambient voices live on their OWN lane
  // (cap 22) so music can never starve the 14-voice combat pool. Melody
  // notes stay >= 440Hz and chords are lowpassed below that — no pitched
  // interference with combat cues (kill pops sit at 60-300Hz). No noise
  // percussion: white-noise hats crackled on device (beat audition 2026-11-12)
  // — if percussion ever returns, make it tonal, not a noise burst.

  private startMusic(): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;
    this.stopScheduler();
    const def = MUSIC[this.track] ?? MUSIC.woodlands;
    // ambient bus (fades in) + shared echo send = the "air"
    const amb = ctx.createGain();
    amb.gain.value = 0;
    amb.gain.setTargetAtTime(def.busLevel, ctx.currentTime, 2.5);
    amb.connect(master);
    const sendIn = ctx.createGain();
    const delay = ctx.createDelay(2);
    const fb = ctx.createGain();
    const tone = ctx.createBiquadFilter(); // keeps echo tails dark = lo-fi
    tone.type = 'lowpass';
    tone.frequency.value = 2400;
    const wet = ctx.createGain();
    delay.delayTime.value = def.echo[0];
    fb.gain.value = def.echo[1];
    wet.gain.value = def.echo[2];
    sendIn.connect(delay);
    delay.connect(tone);
    tone.connect(fb); fb.connect(delay); // feedback loop
    tone.connect(wet); wet.connect(amb);
    this.amb = amb;
    this.sendIn = sendIn;
    this.def = def;
    this.seed = 20261112;
    this.cursor = ctx.currentTime + 0.2;
    this.gridIdx = 0;
    this.schedTimer = setInterval(() => this.tickMusic(), 300);
  }

  private stopScheduler(): void {
    if (this.schedTimer !== null) {
      clearInterval(this.schedTimer);
      this.schedTimer = null;
    }
  }

  private tickMusic(): void {
    if (!this.ctx || this.muted || !this.def) return;
    // after a long suspend, currentTime jumps ahead of the cursor: fast-
    // forward whole grid steps (no note pileup), music resumes in phase
    if (this.cursor < this.ctx.currentTime - 0.05) {
      const step = (60 / this.def.bpm) / 2;
      const missed = Math.floor((this.ctx.currentTime - this.cursor) / step);
      this.cursor += missed * step;
      this.gridIdx += missed;
    }
    const horizon = this.ctx.currentTime + 1.2;
    let guard = 0;
    while (this.cursor < horizon && guard++ < 40) this.planTrack();
  }

  private rnd(): number {
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    return this.seed / 0xffffffff;
  }

  /** One scheduled ambient voice: soft attack, dark filter, optional echo
   *  send. Own voice lane with its own cap — combat cues always win. */
  private ambVoice(o: { freq: number; to?: number; dur: number; vol: number; at: number;
    type?: Wave; attack?: number; filter?: number; send?: number }): void {
    const ctx = this.ctx;
    if (!ctx || !this.amb || this.schedVoices > 22) return;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(o.freq, o.at);
    if (o.to !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.to), o.at + o.dur);
    const a = o.attack ?? 0.02;
    const rel = Math.max(0.12, Math.min(1.2, o.dur * 0.4));
    g.gain.setValueAtTime(0.0001, o.at);
    g.gain.linearRampToValueAtTime(o.vol, o.at + a);
    g.gain.setValueAtTime(o.vol, o.at + Math.max(a + 0.01, o.dur - rel));
    g.gain.exponentialRampToValueAtTime(0.0001, o.at + o.dur);
    let node: AudioNode = g;
    osc.connect(g);
    if (o.filter) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = o.filter;
      g.connect(f); node = f;
    }
    node.connect(this.amb);
    if (o.send && this.sendIn) {
      const s = ctx.createGain();
      s.gain.value = o.send;
      node.connect(s); s.connect(this.sendIn);
      // the send gain node is per-voice; release it with the note
      osc.onended = () => { this.schedVoices--; s.disconnect(); };
    } else {
      osc.onended = () => { this.schedVoices--; };
    }
    this.schedVoices++;
    osc.start(o.at);
    osc.stop(o.at + o.dur + 0.05);
  }

  // ---- the grid: one chord per bar + melody hits on an 8th-note grid ----
  private planTrack(): void {
    const def = this.def as MusicDef;
    const beat = 60 / def.bpm, e8 = beat / 2, bar = beat * 4;
    const slot = this.gridIdx % 32; // 8th index within the 4-bar loop
    const barIdx = Math.floor(slot / 8);
    const at = this.cursor;
    // chord lands on slot 0 of each bar (gentle strum)
    if (slot % 8 === 0) {
      def.chords[barIdx].forEach((n, i) => {
        this.ambVoice({ freq: noteHz(n), dur: bar * 0.92, vol: def.chordVol, at: at + i * 0.03,
          type: 'triangle', attack: def.chordAttack, filter: def.chordFilter, send: def.chordSend });
      });
    }
    // melody: pattern from the def; every Nth loop thins one note out —
    // beats repetition without drifting from the composed material
    for (const [mb, ms, mn, md] of def.melody) {
      if (mb !== barIdx || ms !== slot) continue;
      if (this.gridIdx % (32 * def.thinEvery) >= 32 && (mb * 8 + ms) % 11 === 3) continue;
      const hum = 1 + (this.rnd() - 0.5) * 0.004; // ±4 cents
      this.ambVoice({ freq: noteHz(mn) * hum, dur: md * e8, vol: def.melVol, at: at + (this.rnd() - 0.5) * 0.02,
        type: 'sine', attack: def.melAttack, send: def.melSend });
    }
    this.cursor += e8;
    this.gridIdx++;
  }
}

// note name -> Hz ('F3', 'Bb2', 'C#4'); A4 = 440
const SEMI: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
function noteHz(n: string): number {
  const m = /^([A-G])(#|b)?(\d)$/.exec(n);
  if (!m) return 440;
  const midi = (Number(m[3]) + 1) * 12 + SEMI[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export const audio = new AudioSys();
