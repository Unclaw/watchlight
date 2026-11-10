#!/usr/bin/env node
// Woods-variant screenshots — captures the woods overlay styles for review.
// Usage: node scripts/woods-shots.mjs            → 6 PNGs in repo root
//   watchlight-woods-<style>-L<level>.png  (styles: frame|encroach|surround)
// Levels: 8 (new west-hollow map, dark) + 6 (Wisp Woods, greenest).
// Pre-flight (operator directive): curl :3000 first, no orphan chromium.
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = 9341;
const LEVELS = [8, 6];
const STYLES = ['frame', 'encroach', 'surround'];

const proc = spawn(
  'chromium',
  [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader',
    `--remote-debugging-port=${PORT}`, '--user-data-dir=/tmp/cdp-woods-profile',
    '--window-size=720,1280', 'about:blank',
  ],
  { stdio: 'ignore', detached: true },
);
let id = 0;
const pend = new Map();

try {
  await sleep(2500);
  let list = [];
  for (let t = 0; t < 20; t++) {
    list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    const p = list.find((t) => t.type === 'page');
    if (p) break;
    await sleep(500);
  }
  const page = list.find((t) => t.type === 'page');
  if (!page) throw new Error('no page target — chromium did not start');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  ws.onmessage = (ev) => {
    const m = JSON.parse(typeof ev.data === 'string' ? ev.data : '');
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
  };
  const call = (method, params = {}) =>
    new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const evl = async (e) => {
    const r = await call('Runtime.evaluate', { expression: e, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(`eval failed: ${e.slice(0, 80)}`);
    return r.result?.result?.value;
  };

  for (const style of STYLES) {
    for (const level of LEVELS) {
      await call('Page.enable');
      await call('Emulation.setDeviceMetricsOverride', { width: 720, height: 1280, deviceScaleFactor: 1, mobile: false });
      await call('Page.navigate', { url: `http://127.0.0.1:3000/?scene=game&level=${level}&woods=${style}` });
      // wake rAF: headless clock is frozen until first input (gotcha)
      await sleep(1800);
      const ready = await evl(`(() => {
        const g = window.__game;
        if (!g) return false;
        const s = g.scene.getScene('Game');
        if (!s || !s.scene.isActive()) return false;
        // wake click at a dead zone (top-left sky area), canvas-relative
        const c = document.querySelector('canvas');
        const r = c.getBoundingClientRect();
        c.dispatchEvent(new PointerEvent('pointerdown', { clientX: r.left + 8, clientY: r.top + 8, bubbles: true }));
        c.dispatchEvent(new PointerEvent('pointerup', { clientX: r.left + 8, clientY: r.top + 8, bubbles: true }));
        return true;
      })()`);
      if (!ready) throw new Error(`scene not ready for ${style} L${level}`);
      // poll until ambience graphics exist (drawAmbience runs in create)
      let ok = false;
      for (let t = 0; t < 40; t++) {
        ok = await evl(`(() => {
          const s = window.__game.scene.getScene('Game');
          return s.children.list.some((o) => o.type === 'Graphics');
        })()`);
        if (ok) break;
        await sleep(150);
      }
      if (!ok) throw new Error(`ambience never drew for ${style} L${level}`);
      await sleep(700); // let the first tween frames settle
      const shot = await call('Page.captureScreenshot', { format: 'png' });
      const out = `watchlight-woods-${style}-L${level}.png`;
      writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
      console.log(`wrote ${out}`);
    }
  }
} finally {
  try { process.kill(-proc.pid, 'SIGKILL'); } catch { proc.kill('SIGKILL'); }
}
