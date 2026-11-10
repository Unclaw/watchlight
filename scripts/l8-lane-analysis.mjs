// Throwaway: L8 flyer-lane × tile coverage analysis.
// Lanes (flyerSpawns -> lantern 140,1000):
const LANES = {
  right: [[760, 240], [140, 1000]],
  mid: [[360, -80], [140, 1000]],
  left: [[-60, 720], [140, 1000]],
};
const TILES = [
  [300, 100], [480, 320], [300, 320], [60, 560], [300, 560], [420, 560],
  [660, 560], [300, 780], [480, 780], [660, 820], [300, 960], [100, 860],
];
const RANGES = { ember: [150, 158, 168], prism: [205, 215, 228], kiln: [190, 200, 210] };

function distToSeg(p, [a, b]) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}
// ground path (west hollow) — tiles must stay off it
const GROUND = [
  [360, -60], [360, 200], [600, 200], [600, 440], [160, 440],
  [160, 700], [560, 700], [560, 900], [140, 900], [140, 1000],
];
function distToGround(p) { return Math.min(...GROUND.slice(1).map((b, i) => distToSeg(p, [GROUND[i], b]))); }
function chord(range, d) { return d >= range ? 0 : 2 * Math.sqrt(range * range - d * d); }

for (const [lane, [a, b]] of Object.entries(LANES)) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  console.log(`\n== ${lane} lane (${Math.round(L)}px, ${(L / 72).toFixed(1)}s exposure) ==`);
  TILES.forEach((t, i) => {
    const d = distToSeg(t, [a, b]);
    if (d < 170) {
      const c1 = chord(RANGES.ember[0], d), c2 = chord(RANGES.prism[0], d);
      console.log(`  t${i} (${t}) d=${Math.round(d)}  ember150 chord=${Math.round(c1)}px (${(c1 / 72).toFixed(1)}s)  prism205 chord=${Math.round(c2)}px (${(c2 / 72).toFixed(1)}s)`);
    }
  });
}

// candidate east-watch tiles ON the right lane
console.log('\n== east-watch candidates (ON right lane, >=40px off ground) ==');
for (const c of [[660, 345], [700, 300], [620, 400], [640, 370], [680, 320]]) {
  const dl = distToSeg(c, LANES.right);
  const dg = distToGround(c);
  console.log(`  (${c}) laneDist=${Math.round(dl)} groundDist=${Math.round(dg)} ${dg >= 40 ? 'LEGAL' : 'TOO CLOSE TO PATH'}  ember chord@150=${Math.round(chord(150, dl))}`);
}
