/* AI bots. think() fills in p.inp (the same input a human sends) and returns true to dash.
 * Bots follow the same visibility rules as players: they cannot see into bushes. */
const M = require('./map');

const LEVELS = {
  easy:   { sight: 480, react: 800, err: .22,  lead: 0,  dodge: .08, range: 300 },
  normal: { sight: 600, react: 450, err: .11,  lead: .5, dodge: .30, range: 270 },
  hard:   { sight: 720, react: 220, err: .045, lead: 1,  dodge: .65, range: 250 }
};

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/* ---------------- Pathfinding (A* on a grid) ---------------- */
const CELL = 25, N = 80;
const open = new Uint8Array(N * N);
for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) open[y * N + x] = M.isFree((x + .5) * CELL, (y + .5) * CELL, M.PR + 1) ? 1 : 0;
const centre = i => ({ x: (i % N + .5) * CELL, y: (Math.floor(i / N) + .5) * CELL });

function nearestCell(p) {
  const cx = Math.max(0, Math.min(N - 1, Math.floor(p.x / CELL))), cy = Math.max(0, Math.min(N - 1, Math.floor(p.y / CELL)));
  for (let rad = 0; rad < 8; rad++) {
    let best = -1, bd = Infinity;
    for (let y = cy - rad; y <= cy + rad; y++) for (let x = cx - rad; x <= cx + rad; x++) {
      if (x < 0 || y < 0 || x >= N || y >= N || !open[y * N + x]) continue;
      const d = dist(p, centre(y * N + x));
      if (d < bd) { bd = d; best = y * N + x; }
    }
    if (best >= 0) return best;
  }
  return -1;
}

function push(h, i, f) {
  h.push([f, i]);
  let c = h.length - 1;
  while (c > 0) { const q = (c - 1) >> 1; if (h[q][0] <= h[c][0]) break; [h[q], h[c]] = [h[c], h[q]]; c = q; }
}
function pop(h) {
  const top = h[0], last = h.pop();
  if (h.length) {
    h[0] = last;
    for (let c = 0; ;) {
      let s = c; const l = 2 * c + 1, rr = l + 1;
      if (l < h.length && h[l][0] < h[s][0]) s = l;
      if (rr < h.length && h[rr][0] < h[s][0]) s = rr;
      if (s === c) break;
      [h[s], h[c]] = [h[c], h[s]]; c = s;
    }
  }
  return top[1];
}

function findPath(from, to) {
  const s = nearestCell(from), t = nearestCell(to);
  if (s < 0 || t < 0) return [];
  const g = new Float64Array(N * N).fill(Infinity), prev = new Int32Array(N * N).fill(-1), done = new Uint8Array(N * N);
  const tx = t % N, ty = Math.floor(t / N);
  const h = i => { const dx = Math.abs(i % N - tx), dy = Math.abs(Math.floor(i / N) - ty); return Math.max(dx, dy) + .414 * Math.min(dx, dy); };
  const heap = []; g[s] = 0; push(heap, s, h(s));
  while (heap.length) {
    const i = pop(heap);
    if (i === t) {
      const path = [];
      for (let c = t; c !== -1; c = prev[c]) path.push(centre(c));
      return path.reverse();
    }
    if (done[i]) continue;
    done[i] = 1;
    const x = i % N, y = Math.floor(i / N);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= N || ny >= N || !open[ny * N + nx]) continue;
      if (dx && dy && (!open[y * N + nx] || !open[ny * N + x])) continue; // no corner cutting
      const j = ny * N + nx, cost = g[i] + (dx && dy ? 1.414 : 1);
      if (cost < g[j]) { g[j] = cost; prev[j] = i; push(heap, j, cost + h(j)); }
    }
  }
  return [];
}

/* Unit direction towards goal, steering around walls. */
function steer(g, p, ai, goal) {
  if (M.lineClear(p, goal, M.PR - 1)) { ai.path = null; return toward(p, goal); }
  if (!ai.path || g.t >= ai.repathAt || dist(ai.pathGoal, goal) > 80) {
    ai.path = findPath(p, goal); ai.pathGoal = { x: goal.x, y: goal.y }; ai.repathAt = g.t + 700 + Math.random() * 300;
  }
  const path = ai.path;
  while (path.length > 1 && (dist(p, path[0]) < 14 || M.lineClear(p, path[1], M.PR - 1))) path.shift();
  return path.length ? toward(p, path[0]) : toward(p, goal);
}
function toward(a, b) {
  const d = dist(a, b);
  return d < 6 ? { x: 0, y: 0 } : { x: (b.x - a.x) / d, y: (b.y - a.y) / d };
}

/* ---------------- Decisions ---------------- */
function newBrain(g) {
  return { path: null, pathGoal: null, repathAt: 0, targetId: null, seenAt: 0, err: 0, errAt: 0, strafe: 1, strafeAt: 0,
    wander: null, wanderUntil: 0, safe: null, safeKey: '', seen: new Set(), checkAt: g.t + 1000, last: null, unstickUntil: 0, unstick: null };
}

function spotIn(circle, spread) {
  return M.freeSpot(M.PR + 8, [], { x: circle.x, y: circle.y, r: Math.max(40, circle.r * spread) }) || { x: circle.x, y: circle.y };
}

function pickTarget(r, p, L) {
  let best = null, bd = L.sight;
  for (const o of r.players.values()) {
    if (o === p || !o.alive || (o.bush >= 0 && o.bush !== p.bush)) continue;
    const d = dist(p, o);
    // slight preference for the current target, to avoid flip-flopping
    const score = o.id === p.ai.targetId ? d - 80 : d;
    if (score < bd && M.lineClear(p, o, 3)) { best = o; bd = score; }
  }
  return best;
}

function pickPowerup(g, p) {
  let best = null, bd = 520;
  for (const w of g.powerups) {
    if (w.t === 'food' && p.hp >= 100) continue;
    if (w.t === 'shield' && p.shield >= 60) continue;
    if (Math.hypot(w.x - g.zone.x, w.y - g.zone.y) > g.zone.r) continue;
    let d = dist(p, w);
    if (w.t === 'food' && p.hp < 50) d *= .4;
    if (d < bd) { bd = d; best = w; }
  }
  return best;
}

/* Should the bot dash out of the way of an incoming arrow? Each arrow is judged once. */
function dodge(g, p, L, ai) {
  for (const a of g.arrows) {
    if (a.owner === p.id || ai.seen.has(a.id)) continue;
    const rx = p.x - a.x, ry = p.y - a.y, v2 = a.vx * a.vx + a.vy * a.vy;
    const t = (rx * a.vx + ry * a.vy) / v2;
    if (t <= 0 || t > .35) continue;
    const mx = rx - a.vx * t, my = ry - a.vy * t;
    if (Math.hypot(mx, my) > M.PR + 10) continue;
    ai.seen.add(a.id);
    if (g.t >= p.dashReady && Math.random() < L.dodge) {
      const v = Math.sqrt(v2);
      let sx = -a.vy / v, sy = a.vx / v;
      if (sx * mx + sy * my < 0) { sx = -sx; sy = -sy; }
      if (!M.isFree(p.x + sx * 80, p.y + sy * 80, M.PR)) { sx = -sx; sy = -sy; }
      return { x: sx, y: sy };
    }
  }
  return null;
}

function think(r, p) {
  const g = r.g, z = g.zone, L = LEVELS[p.bot] || LEVELS.normal;
  const ai = p.ai || (p.ai = newBrain(g));

  const target = pickTarget(r, p, L);
  if (target && target.id !== ai.targetId) { ai.targetId = target.id; ai.seenAt = g.t; }
  if (!target) ai.targetId = null;

  // --- where to move ---
  const closing = z.next && (z.mode === 'shrink' || z.left < 10);
  const aim0 = closing ? z.next : z;
  const dNow = Math.hypot(p.x - z.x, p.y - z.y);
  const urgent = dNow > z.r - 35 || (closing && Math.hypot(p.x - z.next.x, p.y - z.next.y) > z.next.r * .85);
  let move = { x: 0, y: 0 }, wantDash = false;

  if (urgent) {
    const key = `${z.phase}:${closing ? 1 : 0}`;
    if (ai.safeKey !== key || !ai.safe) { ai.safeKey = key; ai.safe = spotIn(aim0, .55); }
    move = steer(g, p, ai, ai.safe);
    if (dNow > z.r && g.t >= p.dashReady && M.lineClear(p, { x: p.x + move.x * 150, y: p.y + move.y * 150 }, M.PR)) wantDash = true;
  } else {
    const item = pickPowerup(g, p);
    const grab = item && (!target || (item.t === 'food' && p.hp < 50) || dist(p, item) < 130);
    if (grab) move = steer(g, p, ai, item);
    else if (target) {
      const d = dist(p, target), f = toward(p, target);
      if (g.t >= ai.strafeAt) { ai.strafe = Math.random() < .5 ? -1 : 1; ai.strafeAt = g.t + 500 + Math.random() * 900; }
      const approach = d > L.range + 60 ? 1 : d < L.range - 90 ? -1 : 0;
      move = { x: f.x * approach - f.y * ai.strafe * .8, y: f.y * approach + f.x * ai.strafe * .8 };
      if (!M.isFree(p.x + move.x * 40, p.y + move.y * 40, M.PR - 2)) ai.strafe = -ai.strafe;
    } else {
      if (!ai.wander || g.t >= ai.wanderUntil || dist(p, ai.wander) < 30) { ai.wander = spotIn(aim0, .8); ai.wanderUntil = g.t + 7000; }
      move = steer(g, p, ai, ai.wander);
    }
  }

  // --- unstick ---
  if (g.t >= ai.checkAt) {
    if (ai.last && dist(ai.last, p) < 20 && Math.hypot(p.inp.dx, p.inp.dy) > .5) {
      const a = Math.random() * Math.PI * 2;
      ai.unstick = { x: Math.cos(a), y: Math.sin(a) }; ai.unstickUntil = g.t + 400;
      ai.path = null; ai.wander = null; ai.safe = null;
    }
    ai.last = { x: p.x, y: p.y }; ai.checkAt = g.t + 1000;
  }
  if (g.t < ai.unstickUntil) move = ai.unstick;

  const away = dodge(g, p, L, ai);
  if (away) { move = away; wantDash = true; }

  // --- aim and shoot ---
  let angle = p.inp.a, fire = false;
  if (target) {
    if (g.t >= ai.errAt) { ai.err = (Math.random() * 2 - 1) * L.err; ai.errAt = g.t + 400; }
    const t = dist(p, target) / 650 * L.lead;
    angle = Math.atan2(target.y + target.vy * t - p.y, target.x + target.vx * t - p.x) + ai.err;
    fire = g.t - ai.seenAt >= L.react;
  } else if (move.x || move.y) angle = Math.atan2(move.y, move.x);

  p.inp = { dx: move.x, dy: move.y, a: angle, s: fire };
  return wantDash;
}

module.exports = { think, findPath, LEVELS };
