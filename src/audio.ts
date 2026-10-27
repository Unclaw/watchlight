// Procedural WebAudio engine — zero audio assets.
// iOS rules honoured (research §5.1): AudioContext is created/resumed inside a
// real gesture handler, simultaneous voices are capped, every cue is throttled.
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
  private throttles: Record<string, number> = {
    shoot: 55, hit: 70, kill: 90, beam: 120, splash: 90, heal: 250, aura: 0,
  };
  muted = false;
  private ambientOn = false;

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
      case 'heal': this.tone({ freq: 700, to: 900, dur: 0.12, type: 'sine', vol: 0.05 }); break;
      case 'victory':
        [392, 494, 587, 784].forEach((f, i) => this.tone({ freq: f, dur: 0.18, vol: 0.16, delay: i * 130 }));
        break;
      case 'defeat':
        [392, 311, 233, 175].forEach((f, i) => this.tone({ freq: f, dur: 0.22, vol: 0.16, delay: i * 160 }));
        break;
      case 'tap': this.tone({ freq: 500, to: 400, dur: 0.04, type: 'triangle', vol: 0.07 }); break;
    }
  }

  /** Soft two-oscillator pad + slow noise shimmer, barely audible. */
  private startAmbient(): void {
    if (this.ambientOn || !this.ctx || !this.master) return;
    this.ambientOn = true;
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.value = 0;
    g.gain.setTargetAtTime(0.05, ctx.currentTime, 3);
    const o1 = ctx.createOscillator(); o1.type = 'sine'; o1.frequency.value = 55;
    const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = 55.6;
    const o3 = ctx.createOscillator(); o3.type = 'triangle'; o3.frequency.value = 110.3;
    const g3 = ctx.createGain(); g3.gain.value = 0.35;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07;
    const lfoG = ctx.createGain(); lfoG.gain.value = 0.02;
    lfo.connect(lfoG); lfoG.connect(g.gain);
    o1.connect(g); o2.connect(g); o3.connect(g3); g3.connect(g);
    g.connect(this.master);
    o1.start(); o2.start(); o3.start(); lfo.start();
  }
}

export const audio = new AudioSys();
