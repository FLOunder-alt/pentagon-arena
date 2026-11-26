/* Authoritative match rules: movement, dash, arrows, power-ups, storm, placements.
 *
 * A "room" r needs: r.players (Map id -> player), r.state, r.g, and r.net with
 *   net.all(event, data)        send to everyone in the room
 *   net.to(id, event, data)     send to one human player
 *   net.ended()                 called after a match finishes
 */
const M = require('./map');
const CFG = require('./config');
const bots = require('./bots');

const dmgOf = p => 10 * Math.pow(2, p.dmg);
const cdOf = p => 2000 / Math.pow(1.5, p.agi);
const emptyInput = () => ({ dx: 0, dy: 0, a: 0, s: false });
const aliveList = r => [...r.players.values()].filter(p => p.alive);

function makePlayer(id, username, color, botLevel = null) {
  return resetPlayer({ id, username, color, bot: botLevel });
}
function resetPlayer(p) {
  return Object.assign(p, {
    alive: false, hp: 100, shield: 0, x: 0, y: 0, vx: 0, vy: 0, a: 0,
    dmg: 0, agi: 0, kills: 0, dealt: 0, place: 0, survived: 0,
    nextShot: 0, lastShot: -1e9, bush: -1,
    hasteUntil: 0, multiUntil: 0, ricochetUntil: 0,
    dashReady: 0, dashT: 0, dashX: 0, dashY: 0, stormAcc: 0,
    inp: emptyInput(), ai: null
  });
}

/* ---------------- Storm ---------------- */
function nextCircle(from, radius) {
  // The new circle always fits inside the old one, with its centre well inside the arena.
  const slack = Math.max(0, from.r - radius);
  for (let n = 0; n < 200; n++) {
    const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * slack;
    const c = { x: from.x + Math.cos(a) * d, y: from.y + Math.sin(a) * d };
    if (M.insideDist(c) > Math.max(60, Math.min(radius * .55, 300))) return { x: c.x, y: c.y, r: radius };
  }
  return { x: from.x, y: from.y, r: radius };
}
function newZone() {
  const start = { x: M.C.x, y: M.C.y, r: CFG.STORM_START_RADIUS };
  return { ...start, phase: 0, mode: 'wait', left: CFG.STORM_PHASES[0].wait, from: start, to: nextCircle(start, CFG.STORM_PHASES[0].r) };
}
function updateZone(z, dt) {
  if (z.mode === 'done') return;
  z.left -= dt;
  const ph = CFG.STORM_PHASES[z.phase];
  if (z.mode === 'wait') {
    if (z.left <= 0) { z.mode = 'shrink'; z.left = ph.shrink; z.from = { x: z.x, y: z.y, r: z.r }; }
    return;
  }
  const t = Math.min(1, 1 - z.left / ph.shrink);
  for (const k of ['x', 'y', 'r']) z[k] = z.from[k] + (z.to[k] - z.from[k]) * t;
  if (z.left > 0) return;
  if (z.phase + 1 < CFG.STORM_PHASES.length) {
    z.phase++; z.mode = 'wait'; z.left = CFG.STORM_PHASES[z.phase].wait;
    z.to = nextCircle(z, CFG.STORM_PHASES[z.phase].r);
  } else { z.mode = 'done'; z.left = 0; }
}
const outsideZone = (z, p) => z.r < 1 || Math.hypot(p.x - z.x, p.y - z.y) > z.r;

/* ---------------- Match lifecycle ---------------- */
function start(r) {
  r.state = 'playing';
  r.g = { t: 0, arrows: [], powerups: [], nextPower: 0, id: 0, zone: newZone(), ev: [], roster: new Map(), done: false };
  const placed = [];
  for (const p of r.players.values()) {
    resetPlayer(p);
    const s = M.freeSpot(M.PR + 30, placed) || M.freeSpot(M.PR + 30) || { ...M.C };
    placed.push(s);
    Object.assign(p, { x: s.x, y: s.y, alive: true });
    r.g.roster.set(p.id, p);
  }
}

const tag = p => p && ({ id: p.id, name: p.username, color: p.color, bot: !!p.bot });

function eliminate(r, v, killer, cause) {
  const g = r.g;
  if (!v.alive || g.done) return;
  v.alive = false; v.hp = 0; v.shield = 0; v.bush = -1; v.dashT = 0;
  v.hasteUntil = v.multiUntil = v.ricochetUntil = 0;
  const left = aliveList(r).length;
  v.place = left + 1; v.survived = g.t;
  if (killer && killer !== v) {
    killer.kills++;
    if (!killer.bot && r.players.has(killer.id)) r.net.to(killer.id, 'statsAdd', { kills: 1 });
  }
  r.net.all('feed', { victim: tag(v), killer: killer ? tag(killer) : null, cause, place: v.place, total: g.roster.size, alive: left });
  if (left <= 1) g.done = true;
}

/* Remove a player who leaves mid-match. Call before deleting them from r.players. */
function leave(r, p) {
  if (r.state === 'playing') eliminate(r, p, null, 'left');
}

function finish(r) {
  if (r.state !== 'playing' || !r.g.done) return;
  const g = r.g, winner = aliveList(r)[0] || null;
  if (winner) { winner.place = 1; winner.survived = g.t; }
  const results = [...g.roster.values()]
    .sort((a, b) => a.place - b.place)
    .map(p => ({ ...tag(p), place: p.place, kills: p.kills, dmg: Math.round(p.dealt), time: Math.round(p.survived / 1000) }));
  r.state = 'lobby'; r.g = null;
  r.net.all('gameOver', { winner: winner ? winner.username : null, winnerId: winner ? winner.id : null, duration: Math.round(g.t / 1000), results });
  if (winner && !winner.bot) r.net.to(winner.id, 'statsAdd', { wins: 1 });
  r.net.ended();
}

/* ---------------- Actions ---------------- */
function dash(r, p) {
  const g = r.g;
  if (r.state !== 'playing' || !p.alive || g.t < p.dashReady) return false;
  let { dx, dy } = p.inp;
  const m = Math.hypot(dx, dy);
  if (m > .01) { dx /= m; dy /= m; } else { dx = Math.cos(p.inp.a); dy = Math.sin(p.inp.a); }
  p.dashX = dx; p.dashY = dy; p.dashT = CFG.DASH_TIME; p.dashReady = g.t + CFG.DASH_COOLDOWN;
  g.ev.push({ t: 'dash', id: p.id, x: Math.round(p.x), y: Math.round(p.y) });
  return true;
}

function damage(r, v, amount, owner) {
  if (!v.alive || r.g.done) return;
  const attacker = r.g.roster.get(owner) || null;
  const absorbed = Math.min(v.shield, amount);
  const toHp = Math.min(v.hp, amount - absorbed);
  v.shield -= absorbed; v.hp -= toHp;
  if (attacker) attacker.dealt += absorbed + toHp;
  r.g.ev.push({ t: 'hit', id: v.id, by: owner, x: Math.round(v.x), y: Math.round(v.y), sh: toHp === 0 });
  if (v.hp <= 0) eliminate(r, v, attacker, 'arrow');
}

function pickType() {
  const entries = Object.entries(CFG.POWERUP_WEIGHTS);
  let n = Math.random() * entries.reduce((s, e) => s + e[1], 0);
  for (const [type, w] of entries) if ((n -= w) < 0) return type;
  return entries[0][0];
}
function spawnPowerups(g) {
  const z = g.zone, area = z.to.r > 80 ? z.to : z;
  for (let i = 0; i < CFG.POWERUP_BATCH && g.powerups.length < CFG.POWERUP_MAX; i++) {
    const s = M.freeSpot(24, [], area.r < M.R ? area : null);
    if (s) g.powerups.push({ id: ++g.id, t: pickType(), x: Math.round(s.x), y: Math.round(s.y) });
  }
}
function applyPowerup(g, p, type) {
  if (type === 'power') p.dmg++;
  else if (type === 'agility') p.agi++;
  else if (type === 'food') p.hp = Math.min(100, p.hp + CFG.FOOD_HEAL);
  else if (type === 'shield') p.shield = Math.min(CFG.SHIELD_MAX, p.shield + CFG.SHIELD_GAIN);
  else if (type === 'haste') p.hasteUntil = g.t + CFG.HASTE_TIME;
  else if (type === 'multi') p.multiUntil = g.t + CFG.MULTI_TIME;
  else if (type === 'ricochet') p.ricochetUntil = g.t + CFG.RICOCHET_TIME;
}

function shoot(g, p) {
  p.nextShot = g.t + cdOf(p); p.lastShot = g.t;
  const spread = g.t < p.multiUntil ? [-CFG.MULTI_SPREAD, 0, CFG.MULTI_SPREAD] : [0];
  const bounces = g.t < p.ricochetUntil ? CFG.RICOCHET_BOUNCES : 0;
  for (const off of spread) {
    const a = p.a + off, x = p.x + Math.cos(a) * (M.PR + 4), y = p.y + Math.sin(a) * (M.PR + 4);
    if (M.insideDist({ x, y }) < 0 || M.inSolid(x, y)) continue; // bow is against a wall
    g.arrows.push({ id: ++g.id, x, y, vx: Math.cos(a) * CFG.ARROW_SPEED, vy: Math.sin(a) * CFG.ARROW_SPEED, owner: p.id, dmg: dmgOf(p), life: CFG.ARROW_LIFE, bounces });
  }
  g.ev.push({ t: 'shot', id: p.id, x: Math.round(p.x), y: Math.round(p.y) });
}

/* Move one arrow by h seconds. Returns false when it should disappear. */
function stepArrow(r, a, h) {
  const nx = a.x + a.vx * h, ny = a.y + a.vy * h;
  const out = M.insideDist({ x: nx, y: ny }) < 0;
  if (out || M.inSolid(nx, ny)) {
    if (a.bounces <= 0) return false;
    a.bounces--;
    if (out) { // reflect off the pentagon edge that was crossed
      for (const e of M.edges) {
        const into = a.vx * e.nx + a.vy * e.ny;
        if ((nx - e.a.x) * e.nx + (ny - e.a.y) * e.ny < 0 && into < 0) { a.vx -= 2 * into * e.nx; a.vy -= 2 * into * e.ny; }
      }
    } else {
      let fx = M.inSolid(nx, a.y), fy = M.inSolid(a.x, ny);
      if (!fx && !fy) fx = fy = true; // exact corner
      if (fx) a.vx = -a.vx;
      if (fy) a.vy = -a.vy;
    }
    return true;
  }
  a.x = nx; a.y = ny;
  for (const p of r.players.values()) {
    if (p.alive && p.id !== a.owner && Math.hypot(p.x - a.x, p.y - a.y) < M.PR + 3) { damage(r, p, a.dmg, a.owner); return false; }
  }
  return true;
}

function movePlayer(g, p, dt) {
  const ox = p.x, oy = p.y;
  if (p.alive && p.dashT > 0) {
    const dist = CFG.DASH_SPEED * Math.min(dt, p.dashT), steps = Math.max(1, Math.ceil(dist / 6));
    for (let s = 0; s < steps; s++) { // small steps so a dash cannot tunnel through walls
      p.x += p.dashX * dist / steps; p.y += p.dashY * dist / steps; M.collide(p, true);
    }
    p.dashT -= dt;
  } else {
    let { dx, dy } = p.inp; const m = Math.hypot(dx, dy);
    if (m > 1) { dx /= m; dy /= m; }
    const speed = p.alive ? CFG.MOVE_SPEED * (g.t < p.hasteUntil ? CFG.HASTE_MULT : 1) : CFG.GHOST_SPEED;
    p.x += dx * speed * dt; p.y += dy * speed * dt;
    M.collide(p, p.alive); // ghosts pass through walls
  }
  p.a = p.inp.a;
  p.vx = (p.x - ox) / dt; p.vy = (p.y - oy) / dt;
}

function tick(r, dt) {
  const g = r.g;
  g.t += dt * 1000;
  updateZone(g.zone, dt);
  if (g.t >= g.nextPower) { g.nextPower = g.t + CFG.POWERUP_INTERVAL; spawnPowerups(g); }

  for (const p of r.players.values()) if (p.bot && p.alive && bots.think(r, p, dt)) dash(r, p);

  for (const p of r.players.values()) {
    if (p.bot && !p.alive) continue;
    movePlayer(g, p, dt);
    if (!p.alive) continue;
    p.bush = M.bushes.findIndex(b => Math.hypot(p.x - b.x, p.y - b.y) < b.r);
    for (let k = g.powerups.length - 1; k >= 0; k--) {
      const w = g.powerups[k];
      if (Math.hypot(p.x - w.x, p.y - w.y) < M.PR + 14) {
        applyPowerup(g, p, w.t);
        g.powerups.splice(k, 1);
        g.ev.push({ t: 'pickup', id: p.id, k: w.t, x: w.x, y: w.y });
      }
    }
    if (p.inp.s && g.t >= p.nextShot) shoot(g, p);
  }

  for (let k = g.arrows.length - 1; k >= 0; k--) {
    const a = g.arrows[k];
    // 2 substeps so arrows can't tunnel through walls
    const ok = stepArrow(r, a, dt / 2) && stepArrow(r, a, dt / 2);
    a.life -= dt;
    if (!ok || a.life <= 0) g.arrows.splice(k, 1);
  }

  // Storm damage ignores shields. Lowest HP goes first, so the healthiest survives a tie.
  const dps = CFG.STORM_PHASES[g.zone.phase].dps;
  for (const p of aliveList(r).sort((a, b) => a.hp - b.hp)) {
    if (!outsideZone(g.zone, p)) { p.stormAcc = 0; continue; }
    p.stormAcc += dps * dt;
    const n = Math.floor(p.stormAcc);
    if (n < 1 || g.done) continue;
    p.stormAcc -= n; p.hp -= n;
    g.ev.push({ t: 'storm', id: p.id });
    if (p.hp <= 0) eliminate(r, p, null, 'storm');
  }

  broadcast(r);
  finish(r);
}

/* ---------------- Network snapshot ---------------- */
// Ghosts see everyone; living players only see living players who are not hiding (unless in the same bush).
const visible = (viewer, p) => !viewer.alive || p === viewer || (p.alive && (p.bush < 0 || p.bush === viewer.bush));

function broadcast(r) {
  const g = r.g, all = [...r.players.values()], z = g.zone;
  const alive = all.filter(p => p.alive).length;
  const ar = g.arrows.map(a => ({ x: Math.round(a.x), y: Math.round(a.y), a: +Math.atan2(a.vy, a.vx).toFixed(2), b: a.bounces > 0 ? 1 : 0 }));
  const round = c => ({ x: Math.round(c.x), y: Math.round(c.y), r: Math.round(c.r) });
  const zone = {
    ...round(z), next: z.mode === 'done' ? null : round(z.to), mode: z.mode, left: Math.max(0, Math.ceil(z.left)),
    phase: z.phase + 1, phases: CFG.STORM_PHASES.length, dps: CFG.STORM_PHASES[z.phase].dps
  };
  const left = t => Math.max(0, Math.ceil(t - g.t));
  for (const v of all) {
    if (v.bot) continue;
    const ps = [];
    for (const p of all) {
      if ((p.bot && !p.alive) || !visible(v, p)) continue;
      ps.push({
        id: p.id, n: p.username, c: p.color, b: p.bot ? 1 : 0, x: Math.round(p.x), y: Math.round(p.y), a: +p.a.toFixed(2),
        hp: p.hp, sh: p.shield, al: p.alive, d: dmgOf(p), cd: left(p.nextShot), cm: cdOf(p), k: p.kills,
        dc: left(p.dashReady), dm: CFG.DASH_COOLDOWN, ds: p.dashT > 0 ? 1 : 0,
        fired: g.t - p.lastShot < 1500 ? 1 : 0,
        fx: { haste: left(p.hasteUntil), multi: left(p.multiUntil), ricochet: left(p.ricochetUntil) }
      });
    }
    // Only send events the viewer is allowed to know about (no sounds from hidden players).
    const ev = [];
    for (const e of g.ev) {
      const src = r.players.get(e.id);
      if (e.t === 'storm') { if (e.id === v.id) ev.push(e); }
      else if (e.t === 'pickup') { if (!v.alive || e.id === v.id || (src && visible(v, src))) ev.push(e); }
      else if (!v.alive || e.id === v.id || (src && visible(v, src))) ev.push(e);
      else if (e.t === 'hit' && (e.by === v.id || !src || !src.alive)) ev.push({ t: 'hit', id: e.id, by: e.by });
    }
    r.net.to(v.id, 'state', { p: ps, ar, pw: g.powerups, alive, total: g.roster.size, zone, ev });
  }
  g.ev = [];
}

module.exports = { makePlayer, start, tick, dash, leave, finish, damage, eliminate, visible, applyPowerup, updateZone, newZone, outsideZone, dmgOf, cdOf, emptyInput };
