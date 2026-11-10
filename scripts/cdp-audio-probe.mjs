// Audio diagnosis probe (2026-11-09): "laser-like electrical distortion heard
// in menu AND game on v0.8.1". Derives from cdp-smoke.mjs harness conventions
// (wake click at game (360,420), canvas-rect mapping, ready-poll before evals).
//
//   Phase A — MENU dwell: WebAudio spy logs every voice the game creates; an
//             AnalyserNode taps the master bus; PCM accumulates IN-PAGE (no
//             giant evaluate payloads) and is analysed there.
//   Phase B — GAME (?scene=game&demo=1&auto=1): real cue mix + voice count.
//   Phase C — OfflineAudioContext render of the ambient pad exactly as
//             startAmbient() builds it — sample-level truth (works even if
//             headless doesn't pull the live graph).
// Usage: node scripts/cdp-audio-probe.mjs   (server on :3000 must be running)
import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const BASE = 'http://127.0.0.1:3000';
const PORT = 9334;
const PROFILE = '/tmp/cdp-audio-probe-profile';

rmSync(PROFILE, { recursive: true, force: true });
// detached + process-group kill: a plain proc.kill() on the browser main can
// orphan the SwiftShader GPU child, which then spins at 300%+ CPU forever
// rendering the menu's infinite tweens (observed 2026-11-09).
const proc = spawn(
  'chromium',
  [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader',
    '--autoplay-policy=no-user-gesture-required',
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
    '--window-size=390,844', `${BASE}/`,
  ],
  { stdio: 'ignore', detached: true },
);

async function getPageWs() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await res.json();
      const page = list.find((t) => t.type === 'page' && t.url.startsWith('http'));
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* devtools not up yet */ }
    await sleep(250);
  }
  throw new Error('no CDP page target');
}

const ws = new WebSocket(await getPageWs());
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let id = 0;
const pending = new Map();
const consoleLog = [];
ws.onmessage = (ev) => {
  const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : '');
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
  if (msg.method === 'Runtime.consoleAPICalled') {
    consoleLog.push(msg.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
  }
};
const call = (method, params = {}) =>
  new Promise((res) => {
    const i = ++id;
    pending.set(i, res);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
const evalJs = async (expression, awaitPromise = false) => {
  const r = await call('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(`page eval failed: ${JSON.stringify(r.result.exceptionDetails).slice(0, 400)}`);
  return r.result?.result?.value;
};

async function gotoUrl(url) {
  await call('Page.enable');
  await call('Page.navigate', { url });
  for (let i = 0; i < 60; i++) {
    const ready = await evalJs('document.readyState === "complete" && !!document.querySelector("#app canvas")').catch(() => false);
    if (ready) return;
    await sleep(250);
  }
  throw new Error(`page never ready: ${url}`);
}

async function click(gameX, gameY) {
  const rect = await evalJs(
    `(() => { const r = document.querySelector('#app canvas').getBoundingClientRect();
       return { x: r.left, y: r.top, w: r.width, h: r.height }; })()`,
  );
  const cx = Math.round(rect.x + (gameX / 720) * rect.w);
  const cy = Math.round(rect.y + (gameY / 1280) * rect.h);
  await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: cx, y: cy, button: 'left', clickCount: 1 });
  await sleep(30);
  await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: cx, y: cy, button: 'left', clickCount: 1 });
}

// ---- the WebAudio spy (injected before any page script runs) ----
const SPY = `
(() => {
  const log = [];
  window.__audioLog = log;
  window.__voices = 0;
  window.__chunks = [];
  const rec = (e) => { if (log.length < 4000) log.push(e); };

  const AC = window.AudioContext;
  const co = AC.prototype.createOscillator;
  AC.prototype.createOscillator = function (...a) {
    const o = co.apply(this, a);
    rec({ t: Math.round(performance.now()), e: 'osc', type: o.type, f: o.frequency.value });
    return o;
  };
  const cb = AC.prototype.createBufferSource;
  AC.prototype.createBufferSource = function (...a) {
    const s = cb.apply(this, a);
    rec({ t: Math.round(performance.now()), e: 'noise', dur: s.buffer ? s.buffer.duration : -1 });
    window.__voices++;
    s.addEventListener('ended', () => window.__voices--);
    return s;
  };
  const ost = OscillatorNode.prototype.start;
  OscillatorNode.prototype.start = function (...a) {
    rec({ t: Math.round(performance.now()), e: 'start', type: this.type, f: this.frequency.value });
    window.__voices++;
    this.addEventListener('ended', () => window.__voices--);
    return ost.apply(this, a);
  };
  const conn = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (dst, ...a) {
    if (dst && dst.constructor && /Destination/.test(dst.constructor.name)) {
      rec({ t: Math.round(performance.now()), e: 'toDest', from: this.constructor.name });
      // LAST gain→destination wins: Phaser boots its own silent AudioContext
      // (masterVolume→destination at page load); the game's master connects
      // later, inside unlock(). Capturing the first one measures Phaser, not us.
      if (/Gain/.test(this.constructor.name)) {
        window.__master = this;
        try {
          const an = this.context.createAnalyser();
          an.fftSize = 4096;
          conn.call(this, an);
          window.__analyser = an;
          window.__ctx = this.context;
        } catch (e) { rec({ e: 'analyser.fail', err: String(e) }); }
      }
    }
    return conn.call(this, dst, ...a);
  };
})();
`;

// ---- in-page analysis helpers ----
const HELPERS = `
window.__spectrum = (data, sr, f0, f1, step, topN) => {
  const N = data.length; const out = [];
  for (let f = f0; f <= f1; f += step) {
    const w = 2 * Math.PI * f / sr;
    const c = 2 * Math.cos(w);
    let s1 = 0, s2 = 0;
    for (let i = 0; i < N; i++) { const s0 = data[i] + c * s1 - s2; s2 = s1; s1 = s0; }
    const p = Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - c * s1 * s2)) * 2 / N;
    out.push([Math.round(f), p]);
  }
  out.sort((a, b) => b[1] - a[1]);
  return out.slice(0, topN || 12);
};
window.__pullStats = () => {
  if (!window.__analyser) return { err: 'no analyser' };
  const a = new Float32Array(4096);
  window.__analyser.getFloatTimeDomainData(a);
  window.__chunks.push(a);
  let sum = 0; let pk = 0;
  for (let i = 0; i < 4096; i++) { sum += a[i] * a[i]; const av = Math.abs(a[i]); if (av > pk) pk = av; }
  return {
    rms: Math.sqrt(sum / 4096), peak: pk,
    ctxTime: window.__ctx ? Math.round(window.__ctx.currentTime * 1000) / 1000 : -1,
    masterGain: window.__master ? window.__master.gain.value : -1,
  };
};
window.__concat = (maxN) => {
  const use = window.__chunks.slice(-maxN);
  const out = new Float32Array(use.length * 4096);
  use.forEach((c, i) => out.set(c, i * 4096));
  return out;
};
`;

async function collectLivePcm(seconds) {
  const stats = [];
  const n = Math.floor(seconds / 0.4);
  for (let i = 0; i < n; i++) {
    const r = await evalJs('window.__pullStats()');
    if (r) stats.push(r);
    await sleep(400);
  }
  return stats;
}

const fmtSpectrum = (peaks) => peaks.map(([f, a]) => `${f}Hz:${a.toPrecision(3)}`).join('  ');

try {
  await call('Page.enable');
  await call('Runtime.enable');
  await call('Page.addScriptToEvaluateOnNewDocument', { source: SPY });
  await call('Page.addScriptToEvaluateOnNewDocument', { source: HELPERS });

  // ---------------- Phase A: menu ----------------
  console.log('=== PHASE A: menu dwell (audio spy + live PCM) ===');
  await gotoUrl(`${BASE}/`);
  await sleep(1500);
  await click(360, 420); // wake click (also unlocks audio — giant tap target)
  await sleep(1000);

  const pullsA = await collectLivePcm(16);
  const logA = await evalJs('window.__audioLog');
  const voicesA = await evalJs('window.__voices');
  const creations = logA.filter((e) => e.e === 'osc' || e.e === 'noise');
  const starts = logA.filter((e) => e.e === 'start');
  console.log(`audioLog: ${logA.length} events | creations: ${JSON.stringify(creations)} | starts: ${starts.length} | voices at end: ${voicesA}`);
  console.log('ctx timeline:', JSON.stringify({
    state: await evalJs('window.__ctx && window.__ctx.state'),
    sr: await evalJs('window.__ctx && window.__ctx.sampleRate'),
    lastCtxTime: pullsA.length ? pullsA[pullsA.length - 1].ctxTime : -1,
    lastMasterGain: pullsA.length ? pullsA[pullsA.length - 1].masterGain : -1,
  }));
  const rmsA = pullsA.map((p) => p.rms);
  console.log(`live master RMS: min=${Math.min(...rmsA).toExponential(2)} max=${Math.max(...rmsA).toExponential(2)} peak=${Math.max(...pullsA.map((p) => p.peak)).toExponential(2)}`);
  const sr = (pullsA.length && pullsA[pullsA.length - 1].sr) || 44100;
  const specA = await evalJs(`window.__spectrum(window.__concat(30), ${sr}, 40, 2400, 2, 14)`);
  console.log('MENU live spectrum top-14:', fmtSpectrum(specA));
  const hfA = await evalJs(`window.__spectrum(window.__concat(30), ${sr}, 2400, 8000, 100, 6)`);
  console.log('MENU live HF band (>2.4kHz) top-6:', fmtSpectrum(hfA));

  // ---------------- Phase B: game (demo towers, waves) ----------------
  console.log('\n=== PHASE B: game (?scene=game&demo=1&auto=1, 16s) ===');
  await gotoUrl(`${BASE}/?scene=game&demo=1&auto=1`);
  await sleep(1500);
  await click(360, 420);
  await sleep(500);
  const started = await evalJs(`(() => { const s = window.__game.scene.getScene('Game'); return s && s.phase === 'wave'; })()`);
  console.log('wave started:', started);
  const pullsB = await collectLivePcm(16);
  const logB = await evalJs('window.__audioLog');
  const voicesB = await evalJs('window.__voices');
  const sig = {};
  for (const e of logB.filter((e) => e.e === 'start')) {
    const k = `${e.type}@${Math.round(e.f)}`;
    sig[k] = (sig[k] || 0) + 1;
  }
  const noises = logB.filter((e) => e.e === 'noise').length;
  console.log(`osc starts by signature: ${JSON.stringify(sig)}`);
  console.log(`noise bursts: ${noises} | voices at end: ${voicesB} (cap 14)`);
  const rmsB = pullsB.map((p) => p.rms);
  console.log(`live master RMS: min=${Math.min(...rmsB).toExponential(2)} max=${Math.max(...rmsB).toExponential(2)} peak=${Math.max(...pullsB.map((p) => p.peak)).toExponential(2)}`);
  const specB = await evalJs(`window.__spectrum(window.__concat(30), ${sr}, 40, 2400, 2, 14)`);
  console.log('GAME live spectrum top-14:', fmtSpectrum(specB));

  // ---------------- Phase C: offline render of the ambient pad ----------------
  console.log('\n=== PHASE C: offline render of startAmbient graph (6s @48k) ===');
  const pad = await evalJs(`(async () => {
    const oc = new OfflineAudioContext(1, 48000 * 6, 48000);
    const master = oc.createGain(); master.gain.value = 0.5; master.connect(oc.destination);
    const g = oc.createGain();
    g.gain.value = 0;
    g.gain.setTargetAtTime(0.05, oc.currentTime, 3);
    g.connect(master);
    const o1 = oc.createOscillator(); o1.type = 'sine'; o1.frequency.value = 55;
    const o2 = oc.createOscillator(); o2.type = 'sine'; o2.frequency.value = 55.6;
    const o3 = oc.createOscillator(); o3.type = 'triangle'; o3.frequency.value = 110.3;
    const g3 = oc.createGain(); g3.gain.value = 0.35;
    const lfo = oc.createOscillator(); lfo.frequency.value = 0.07;
    const lfoG = oc.createGain(); lfoG.gain.value = 0.02;
    lfo.connect(lfoG); lfoG.connect(g.gain);
    o1.connect(g); o2.connect(g); o3.connect(g3); g3.connect(g);
    o1.start(); o2.start(); o3.start(); lfo.start();
    const buf = await oc.startRendering();
    const d = buf.getChannelData(0);
    const tail = d.slice(48000 * 3);
    let sum = 0; let pk = 0;
    for (let i = 0; i < tail.length; i++) { sum += tail[i] * tail[i]; pk = Math.max(pk, Math.abs(tail[i])); }
    window.__padTail = tail;
    return { rms: Math.sqrt(sum / tail.length), peak: pk };
  })()`, true);
  console.log(`pad steady-state: RMS=${pad.rms.toExponential(2)} peak=${pad.peak.toExponential(2)} (full-scale=1.0)`);
  const padSpec = await evalJs('window.__spectrum(window.__padTail.slice(0, 144000), 48000, 40, 2400, 2, 14)');
  console.log('pad spectrum top-14:', fmtSpectrum(padSpec));
  const padHf = await evalJs('window.__spectrum(window.__padTail.slice(0, 144000), 48000, 2400, 12000, 100, 6)');
  console.log('pad HF band (>2.4kHz) top-6:', fmtSpectrum(padHf));

  console.log('\n=== probe done ===');
} catch (e) {
  console.error('PROBE FAILED:', e.message);
  if (consoleLog.length) console.error('page console:', consoleLog.slice(-5));
} finally {
  try { process.kill(-proc.pid, 'SIGKILL'); } catch { /* already gone */ }
  ws.close();
  process.exit(0);
}
