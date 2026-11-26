/* Pentagon map: geometry, deterministic generation and collision helpers. */
const C = { x: 1000, y: 1000 }, R = 900, PR = 16; // centre, pentagon radius, player radius
const verts = [0, 1, 2, 3, 4].map(i => {
  const a = (-90 + 72 * i) * Math.PI / 180;
  return { x: Math.round(C.x + R * Math.cos(a)), y: Math.round(C.y + R * Math.sin(a)) };
});
// edges with inward unit normals
const edges = verts.map((a, i) => {
  const b = verts[(i + 1) % 5], dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy);
  return { a, nx: -dy / l, ny: dx / l };
});
// signed distance to nearest pentagon edge (positive = inside)
function insideDist(p) {
  let m = Infinity;
  for (const e of edges) m = Math.min(m, (p.x - e.a.x) * e.nx + (p.y - e.a.y) * e.ny);
  return m;
}
let seed = 20240611;
function rnd() { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }
const hit = (a, b, p = 0) => a.x < b.x + b.w + p && a.x + a.w > b.x - p && a.y < b.y + b.h + p && a.y + a.h > b.y - p;
function circRect(x, y, b) {
  const nx = Math.max(b.x, Math.min(x, b.x + b.w)), ny = Math.max(b.y, Math.min(y, b.y + b.h));
  const dx = x - nx, dy = y - ny;
  return { dx, dy, d2: dx * dx + dy * dy };
}

const walls = [], deadEnds = [], obstacles = [], bushes = [];
// Dead ends: U-shaped pockets (3 walls) with one open side
function U(x, y, o) {
  const s = 150, t = 20;
  const sets = {
    n: [[x, y + s - t, s, t], [x, y, t, s], [x + s - t, y, t, s]],
    s: [[x, y, s, t], [x, y, t, s], [x + s - t, y, t, s]],
    e: [[x, y, t, s], [x, y, s, t], [x, y + s - t, s, t]],
    w: [[x + s - t, y, t, s], [x, y, s, t], [x, y + s - t, s, t]]
  };
  sets[o].forEach(([x, y, w, h]) => walls.push({ x, y, w, h }));
  deadEnds.push({ x, y, w: s, h: s, open: o });
}
[[900, 260, 's'], [1400, 640, 'w'], [1250, 1350, 'n'], [600, 1350, 'n'], [450, 640, 'e']].forEach(a => U(...a));

// 20 obstacles: 8 long thin walls + 12 blocks
for (let n = 0; n < 6000 && obstacles.length < 20; n++) {
  const i = obstacles.length, horiz = rnd() < .5;
  let w, h;
  if (i < 8) { w = horiz ? 180 + rnd() * 120 : 20; h = horiz ? 20 : 180 + rnd() * 120; }
  else { w = 50 + rnd() * 60; h = 50 + rnd() * 60; }
  const r = { x: Math.round(150 + rnd() * 1700), y: Math.round(100 + rnd() * 1630), w: Math.round(w), h: Math.round(h) };
  const ok = [[r.x, r.y], [r.x + r.w, r.y], [r.x, r.y + r.h], [r.x + r.w, r.y + r.h]].every(([x, y]) => insideDist({ x, y }) > 90)
    && !walls.some(o => hit(r, o, 60)) && !obstacles.some(o => hit(r, o, 60))
    && !hit(r, { x: 920, y: 920, w: 160, h: 160 });
  if (ok) obstacles.push(r);
}
const solids = walls.concat(obstacles);

// 10 hiding spots (bushes): players inside are invisible to players outside
for (let n = 0; n < 6000 && bushes.length < 10; n++) {
  const b = { x: Math.round(200 + rnd() * 1600), y: Math.round(150 + rnd() * 1500), r: 55 + (rnd() * 15 | 0) };
  const ok = insideDist(b) > b.r + 30
    && solids.every(w => circRect(b.x, b.y, w).d2 > (b.r + 20) ** 2)
    && bushes.every(o => Math.hypot(o.x - b.x, o.y - b.y) > o.r + b.r + 60);
  if (ok) bushes.push(b);
}
const MAP = { verts, walls, obstacles, bushes, deadEnds };

/* Can a circle of the given radius stand at (x, y)? */
const isFree = (x, y, rad) => insideDist({ x, y }) > rad && solids.every(w => circRect(x, y, w).d2 > rad * rad);
const inSolid = (x, y) => solids.some(w => x > w.x && x < w.x + w.w && y > w.y && y < w.y + w.h);

/* Is the straight segment a->b clear for a circle of radius rad? */
function lineClear(a, b, rad) {
  const d = Math.hypot(b.x - a.x, b.y - a.y), n = Math.max(1, Math.ceil(d / 8));
  for (let i = 1; i <= n; i++) {
    const x = a.x + (b.x - a.x) * i / n, y = a.y + (b.y - a.y) * i / n;
    if (!isFree(x, y, rad)) return false;
  }
  return true;
}

/* Random open spot. zone = {x,y,r} restricts it to a circle. Returns null if none found. */
function freeSpot(margin, avoid = [], zone = null) {
  for (let n = 0; n < 600; n++) {
    let p;
    if (zone) {
      const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * zone.r;
      p = { x: zone.x + Math.cos(a) * d, y: zone.y + Math.sin(a) * d };
    } else p = { x: 120 + Math.random() * 1760, y: 100 + Math.random() * 1650 };
    if (insideDist(p) > margin + 40 && solids.every(w => circRect(p.x, p.y, w).d2 > margin * margin)
      && avoid.every(o => Math.hypot(o.x - p.x, o.y - p.y) > 300)) return p;
  }
  return null;
}

/* Push a circle out of walls (if solid) and keep it inside the pentagon */
function collide(p, solid) {
  for (let it = 0; it < 2; it++) {
    if (solid) for (const w of solids) {
      const c = circRect(p.x, p.y, w);
      if (c.d2 < PR * PR && c.d2 > 0) { const d = Math.sqrt(c.d2), k = (PR - d) / d; p.x += c.dx * k; p.y += c.dy * k; }
    }
    for (const e of edges) {
      const d = (p.x - e.a.x) * e.nx + (p.y - e.a.y) * e.ny;
      if (d < PR) { p.x += e.nx * (PR - d); p.y += e.ny * (PR - d); }
    }
  }
}

module.exports = { C, R, PR, verts, edges, walls, obstacles, bushes, deadEnds, solids, MAP, insideDist, circRect, isFree, inSolid, lineClear, freeSpot, collide };
