// Background-music track audit (?bg=woodlands|deepmarsh|ashen|default).
// Verifies per track: voice cadence (scheduler alive), no voice runaway,
// master level sanity vs the drone baseline, and live spectrum content in
// the melody band. Derives the WebAudio spy from cdp-audio-probe.mjs.
// Usage: node scripts/lofi-audit.mjs [woodlands|deepmarsh|ashen|default]  (:3000 up)
import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const VARIANT = process.argv[2] ?? 'woodlands';
const BASE = 'http://127.0.0.1:3000';
const PORT = 9335;
const PROFILE = '/tmp/cdp-lofi-audit-profile';
const URL = VARIANT === 'default' ? `${BASE}/?scene=game` : `${BASE}/?scene=game&bg=${VARIANT}`;

rmSync(PROFILE, { recursive: true, force: true });
const proc = spawn(
  'chromium',
  [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader',
    '--autoplay-policy=no-user-gesture-required',
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
    '--window-size=390,844', URL,
  ],
  { stdio: 'ignore', detached: true },
);
const killTree = () => { try { process.kill(-proc.pid, 'SIGKILL'); } catch { try { proc.kill('SIGKILL'); } catch {} } };
process.on('exit', killTree);

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
ws.onmessage = (ev) => {
  const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : '');
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
};
const call = (method, params = {}) =>
  new Promise((res) => {
    const i = ++id;
    pending.set(i, res);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
const evalJs = async (expression, awaitPromise = false) => {
  const r = await call('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(`page eval failed: ${JSON.stringify(r.result.exceptionDetails).slice(0, 300)}`);
  return r.result?.result?.value;
};
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

// ---- the WebAudio spy (from cdp-audio-probe.mjs; LAST gain→destination = game master) ----
const SPY = `
(() => {
  const log = [];
  window.__audioLog = log;
  window.__voices = 0;
  window.__chunks = [];
  const rec = (e) => { if (log.length < 6000) log.push(e); };
  const cb = AC_createBufferSource();
  function AC_createBufferSource() { return AudioContext.prototype.createBufferSource; }
  const co = AudioContext.prototype.createOscillator;
  AudioContext.prototype.createOscillator = function (...a) {
    const o = co.apply(this, a);
    rec({ t: Math.round(performance.now()), e: 'osc' });
    return o;
  };
  AudioContext.prototype.createBufferSource = function (...a) {
    const s = cb.apply(this, a);
    rec({ t: Math.round(performance.now()), e: 'noise' });
    window.__voices++;
    s.addEventListener('ended', () => window.__voices--);
    return s;
  };
  const ost = OscillatorNode.prototype.start;
  OscillatorNode.prototype.start = function (...a) {
    rec({ t: Math.round(performance.now()), e: 'start' });
    window.__voices++;
    this.addEventListener('ended', () => window.__voices--);
    return ost.apply(this, a);
  };
  const conn = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (dst, ...a) {
    if (dst && dst.constructor && /Destination/.test(dst.constructor.name)) {
      if (/Gain/.test(this.constructor.name)) {
        window.__master = this;
        try {
          const an = this.context.createAnalyser();
          an.fftSize = 4096;
          conn.call(this, an);
          window.__analyser = an;
          window.__ctx = this.context;
        } catch (e) { /* keep going */ }
      }
    }
    return conn.call(this, dst, ...a);
  };
})();
`;
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
    voices: window.__voices,
  };
};
window.__concat = (maxN) => {
  const use = window.__chunks.slice(-maxN);
  const out = new Float32Array(use.length * 4096);
  use.forEach((c, i) => out.set(c, i * 4096));
  return out;
};
`;

try {
  await call('Page.enable');
  await call('Runtime.enable');
  await call('Page.addScriptToEvaluateOnNewDocument', { source: SPY });
  await call('Page.addScriptToEvaluateOnNewDocument', { source: HELPERS });
  // injection applies only to documents loaded AFTER registration — the
  // launch-arg document is already past, so navigate (reload) with spy armed
  await call('Page.navigate', { url: URL });

  // page ready: canvas + game scene
  for (let i = 0; i < 60; i++) {
    const ready = await evalJs('document.readyState === "complete" && !!document.querySelector("#app canvas")').catch(() => false);
    if (ready) break;
    await sleep(250);
  }
  await sleep(800);
  // wake + audio unlock (lo-fi/drone starts here). Headless clicks can land
  // pre-gesture — poll for game-audio evidence and retry, never assume.
  for (let attempt = 0; attempt < 4; attempt++) {
    await click(360, 420);
    await sleep(1800);
    const live = await evalJs('window.__audioLog && window.__audioLog.some(e => e.e === "start")');
    if (live) break;
  }
  await sleep(800); // let the ambient bus fade in past the ramp

  const stats = [];
  const voicesTrend = [];
  for (let i = 0; i < 28; i++) {
    const r = await evalJs('window.__pullStats()');
    if (r && !r.err) { stats.push(r); voicesTrend.push(r.voices); }
    await sleep(400);
  }
  const log = await evalJs('window.__audioLog');
  const starts = log.filter((e) => e.e === 'start');
  const noises = log.filter((e) => e.e === 'noise');
  const dwellS = 28 * 0.4;
  const startsPerSec = (starts.length / dwellS).toFixed(2);
  const rms = stats.map((s) => s.rms);
  const sr = (await evalJs('window.__ctx && window.__ctx.sampleRate')) || 44100;
  const spec = await evalJs(`window.__spectrum(window.__concat(28), ${sr}, 80, 1000, 4, 12)`);
  const fmt = spec.map(([f, a]) => `${f}:${a.toPrecision(2)}`).join(' ');
  console.log(`=== bg=${VARIANT} (${URL.replace(BASE, '')}) ===`);
  console.log(`ctx: ${await evalJs('window.__ctx && window.__ctx.state')} @ ${sr}Hz | osc starts: ${starts.length} (${startsPerSec}/s) | noise bursts: ${noises.length}`);
  console.log(`voices: start-of-dwell ${voicesTrend[0]} → end ${voicesTrend[voicesTrend.length - 1]} (max ${Math.max(...voicesTrend)}) — bounded = no runaway`);
  console.log(`master RMS: min ${Math.min(...rms).toExponential(2)} / max ${Math.max(...rms).toExponential(2)} (drone baseline ~1e-2..2e-2)`);
  console.log(`spectrum 80-1000Hz top-12 [Hz:amp]: ${fmt}`);
  const verdict = stats.length > 20 && starts.length > (VARIANT === 'default' ? 10 : 10) && Math.max(...voicesTrend) < 40 ? 'OK' : 'SUSPECT';
  console.log(`VERDICT: ${verdict}`);
} finally {
  killTree();
  await sleep(300);
  ws.close();
}
