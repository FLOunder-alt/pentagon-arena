const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.static(path.join(__dirname, '..', 'client')));

/* ================= Map (pentagon, generated once, deterministic) ================= */
const C = { x: 1000, y: 1000 }, R = 900, PR = 16; // centre, pentagon radius, player radius
const verts = [0, 1, 2, 3, 4].map(i => {
  const a = (-90 + 72 * i) * Math.PI / 180;
  return { x: Math.round(C.x + R * Math.cos(a)), y: Math.round(C.y + R * Math.sin(a)) };
});
// signed distance to nearest pentagon edge (positive = inside)
function insideDist(p) {
  let m = Infinity;
  for (let i = 0; i < 5; i++) {
    const a = verts[i], b = verts[(i + 1) % 5], dx = b.x - a.x, dy = b.y - a.y;
    m = Math.min(m, (dx * (p.y - a.y) - dy * (p.x - a.x)) / Math.hypot(dx, dy));
  }
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
console.log(`Map: ${obstacles.length} obstacles, ${bushes.length} hiding spots, ${deadEnds.length} dead ends, ${walls.length} wall segments`);

function freeSpot(margin, avoid = []) {
  for (let n = 0; n < 600; n++) {
    const p = { x: 120 + Math.random() * 1760, y: 100 + Math.random() * 1650 };
    if (insideDist(p) > margin + 40 && solids.every(w => circRect(p.x, p.y, w).d2 > margin * margin)
      && avoid.every(o => Math.hypot(o.x - p.x, o.y - p.y) > 300)) return p;
  }
  return { x: C.x, y: C.y };
}
// push a circle out of walls (if solid) and keep it inside the pentagon
function collide(p, solid) {
  for (let it = 0; it < 2; it++) {
    if (solid) for (const w of solids) {
      const c = circRect(p.x, p.y, w);
      if (c.d2 < PR * PR && c.d2 > 0) { const d = Math.sqrt(c.d2), k = (PR - d) / d; p.x += c.dx * k; p.y += c.dy * k; }
    }
    for (let i = 0; i < 5; i++) {
      const a = verts[i], b = verts[(i + 1) % 5], dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy);
      const d = (dx * (p.y - a.y) - dy * (p.x - a.x)) / l;
      if (d < PR) { p.x += -dy / l * (PR - d); p.y += dx / l * (PR - d); }
    }
  }
}

/* ================= Rooms ================= */
const rooms = new Map(); // key(lowercase name) -> room
const keyOf = n => String(n || '').trim().toLowerCase();
const roomInfo = r => ({
  name: r.name, max: r.max, hostId: r.hostId, state: r.state,
  players: [...r.players.values()].map(p => ({ id: p.id, username: p.username, color: p.color }))
});
const pushRoom = r => io.to(r.sid).emit('roomUpdate', roomInfo(r));
const pushList = () => io.emit('roomList', [...rooms.values()].filter(r => r.isPublic)
  .map(r => ({ name: r.name, count: r.players.size, max: r.max, locked: !!r.password, state: r.state })));

function addPlayer(r, socket) {
  const a = socket.data.acc;
  r.players.set(socket.id, { id: socket.id, username: a.username, color: a.color, alive: false, hp: 100, x: 0, y: 0, a: 0, dmg: 0, agi: 0, kills: 0, nextShot: 0, bush: -1, inp: { dx: 0, dy: 0, a: 0, s: false } });
  socket.join(r.sid); socket.data.room = r.key;
}
function removePlayer(r, id) {
  r.players.delete(id);
  const s = io.sockets.sockets.get(id);
  if (s) { s.leave(r.sid); s.data.room = null; }
  if (r.state === 'playing') checkWin(r);
  pushRoom(r); pushList();
}
function closeRoom(r) {
  io.to(r.sid).emit('roomClosed');
  for (const id of r.players.keys()) { const s = io.sockets.sockets.get(id); if (s) { s.leave(r.sid); s.data.room = null; } }
  rooms.delete(r.key); pushList();
}

/* ================= Game ================= */
const dmgOf = p => 10 * Math.pow(2, p.dmg);
const cdOf = p => 2000 / Math.pow(1.5, p.agi);

function startGame(r) {
  r.state = 'playing';
  r.g = { arrows: [], powerups: [], nextPower: Date.now(), id: 0 };
  const placed = [];
  for (const p of r.players.values()) {
    const s = freeSpot(PR + 30, placed); placed.push(s);
    Object.assign(p, { x: s.x, y: s.y, hp: 100, alive: true, dmg: 0, agi: 0, kills: 0, nextShot: 0, bush: -1, a: 0, inp: { dx: 0, dy: 0, a: 0, s: false } });
  }
  io.to(r.sid).emit('gameStart', { map: MAP });
  pushRoom(r); pushList();
}

function checkWin(r) {
  if (r.state !== 'playing') return;
  const alive = [...r.players.values()].filter(p => p.alive);
  if (alive.length > 1) return;
  const w = alive[0];
  r.state = 'over';
  io.to(r.sid).emit('gameOver', { winner: w ? w.username : null });
  if (w) io.to(w.id).emit('statsAdd', { wins: 1 });
  setTimeout(() => { if (rooms.get(r.key) !== r) return; r.state = 'lobby'; r.g = null; pushRoom(r); pushList(); }, 6000);
}

function damage(r, v, a) {
  v.hp -= a.dmg;
  if (v.hp > 0) return;
  v.hp = 0; v.alive = false; v.bush = -1;
  const k = r.players.get(a.owner);
  io.to(r.sid).emit('feed', { text: `${k ? k.username : 'Someone'} eliminated ${v.username}` });
  if (k) { k.kills++; io.to(k.id).emit('statsAdd', { kills: 1 }); }
  checkWin(r);
}

function tick(r, dt) {
  const g = r.g, now = Date.now();
  if (now >= g.nextPower) { // 3 random powerups every 30 s
    g.nextPower = now + 30000;
    for (let i = 0; i < 3; i++) {
      const s = freeSpot(24);
      g.powerups.push({ id: ++g.id, t: ['power', 'agility', 'food'][Math.random() * 3 | 0], x: Math.round(s.x), y: Math.round(s.y) });
    }
  }
  for (const p of r.players.values()) {
    const i = p.inp; let dx = i.dx, dy = i.dy; const m = Math.hypot(dx, dy);
    if (m > 1) { dx /= m; dy /= m; }
    const sp = (p.alive ? 220 : 320) * dt;
    p.x += dx * sp; p.y += dy * sp; p.a = i.a;
    collide(p, p.alive); // ghosts pass through walls
    if (!p.alive) continue;
    p.bush = bushes.findIndex(b => Math.hypot(p.x - b.x, p.y - b.y) < b.r);
    for (let k = g.powerups.length - 1; k >= 0; k--) {
      const w = g.powerups[k];
      if (Math.hypot(p.x - w.x, p.y - w.y) < PR + 14) {
        if (w.t === 'power') p.dmg++; else if (w.t === 'agility') p.agi++; else p.hp = Math.min(100, p.hp + 10);
        g.powerups.splice(k, 1);
      }
    }
    if (i.s && now >= p.nextShot) {
      p.nextShot = now + cdOf(p);
      g.arrows.push({ x: p.x + Math.cos(p.a) * (PR + 4), y: p.y + Math.sin(p.a) * (PR + 4), ang: p.a, vx: Math.cos(p.a) * 650, vy: Math.sin(p.a) * 650, owner: p.id, dmg: dmgOf(p), life: 1.5 });
    }
  }
  for (let k = g.arrows.length - 1; k >= 0; k--) {
    const a = g.arrows[k]; let dead = false;
    for (let s = 0; s < 2 && !dead; s++) { // 2 substeps so arrows can't tunnel through walls
      a.x += a.vx * dt / 2; a.y += a.vy * dt / 2;
      if (insideDist(a) < 0 || solids.some(w => a.x > w.x && a.x < w.x + w.w && a.y > w.y && a.y < w.y + w.h)) { dead = true; break; }
      for (const p of r.players.values()) {
        if (p.alive && p.id !== a.owner && Math.hypot(p.x - a.x, p.y - a.y) < PR + 3) { dead = true; damage(r, p, a); break; }
      }
    }
    a.life -= dt;
    if (dead || a.life <= 0) g.arrows.splice(k, 1);
  }
  broadcast(r, now);
}

function broadcast(r, now) {
  const g = r.g, all = [...r.players.values()];
  const alive = all.filter(p => p.alive).length;
  const ar = g.arrows.map(a => ({ x: Math.round(a.x), y: Math.round(a.y), a: +a.ang.toFixed(2) }));
  for (const v of all) {
    const ps = [];
    for (const p of all) {
      // ghosts see everyone; living players only see living players who are not hiding (unless in the same bush)
      const vis = !v.alive || p === v || (p.alive && (p.bush < 0 || p.bush === v.bush));
      if (vis) ps.push({ id: p.id, n: p.username, c: p.color, x: Math.round(p.x), y: Math.round(p.y), a: +p.a.toFixed(2), hp: p.hp, al: p.alive, d: dmgOf(p), cd: Math.max(0, p.nextShot - now), cm: cdOf(p), k: p.kills });
    }
    io.to(v.id).emit('state', { p: ps, ar, pw: g.powerups, alive });
  }
}
setInterval(() => { for (const r of rooms.values()) if (r.state === 'playing') tick(r, 1 / 30); }, 1000 / 30);

/* ================= Sockets ================= */
io.on('connection', socket => {
  const myRoom = () => rooms.get(socket.data.room);
  const clamp = v => Math.max(-1, Math.min(1, +v || 0));

  socket.on('register', (a, cb) => {
    if (!a || typeof a.username !== 'string') return;
    const username = a.username.trim().slice(0, 14) || 'Player';
    const color = /^#[0-9a-f]{6}$/i.test(a.color) ? a.color : '#4da3ff';
    socket.data.acc = { username, color };
    if (typeof cb === 'function') cb({ username });
    pushList();
  });

  socket.on('createRoom', (o, cb) => {
    if (typeof cb !== 'function') return;
    if (!socket.data.acc) return cb({ ok: false, error: 'Create an account first.' });
    if (socket.data.room) return cb({ ok: false, error: 'You are already in a room.' });
    const name = String((o && o.name) || '').trim().slice(0, 20);
    if (name.length < 2) return cb({ ok: false, error: 'Room name needs at least 2 characters.' });
    if (rooms.has(keyOf(name))) return cb({ ok: false, error: 'That room name is already taken.' });
    const r = {
      key: keyOf(name), sid: 'room:' + keyOf(name), name,
      max: Math.max(2, Math.min(5, parseInt(o.max) || 4)),
      password: String(o.password || '').slice(0, 20), isPublic: !!o.isPublic,
      hostId: socket.id, state: 'lobby', players: new Map(), g: null
    };
    rooms.set(r.key, r); addPlayer(r, socket);
    pushRoom(r); pushList(); cb({ ok: true });
  });

  socket.on('joinRoom', (o, cb) => {
    if (typeof cb !== 'function') return;
    if (!socket.data.acc) return cb({ ok: false, error: 'Create an account first.' });
    if (socket.data.room) return cb({ ok: false, error: 'You are already in a room.' });
    const r = rooms.get(keyOf(o && o.name));
    if (!r) return cb({ ok: false, error: 'Room not found.' });
    if (r.password && r.password !== String(o.password || '')) return cb({ ok: false, error: 'Wrong password.' });
    if (r.state !== 'lobby') return cb({ ok: false, error: 'A match is in progress.' });
    if (r.players.size >= r.max) return cb({ ok: false, error: 'Room is full.' });
    addPlayer(r, socket); pushRoom(r); pushList(); cb({ ok: true });
  });

  socket.on('leaveRoom', () => {
    const r = myRoom(); if (!r) return;
    if (r.hostId === socket.id) closeRoom(r); else removePlayer(r, socket.id);
  });
  socket.on('closeRoom', () => { const r = myRoom(); if (r && r.hostId === socket.id) closeRoom(r); });
  socket.on('kick', id => {
    const r = myRoom();
    if (!r || r.hostId !== socket.id || id === socket.id || !r.players.has(id)) return;
    io.to(id).emit('kicked'); removePlayer(r, id);
  });
  socket.on('startGame', () => {
    const r = myRoom();
    if (!r || r.hostId !== socket.id || r.state !== 'lobby') return;
    if (r.players.size < 2) return socket.emit('toast', 'Need at least 2 players to start.');
    startGame(r);
  });
  socket.on('input', d => {
    const r = myRoom(); if (!r || !d) return;
    const p = r.players.get(socket.id); if (!p) return;
    p.inp = { dx: clamp(d.dx), dy: clamp(d.dy), a: Number.isFinite(+d.a) ? +d.a : 0, s: !!d.s };
  });
  socket.on('disconnect', () => {
    const r = myRoom(); if (!r) return;
    if (r.hostId === socket.id) closeRoom(r); else removePlayer(r, socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Pentagon Arena running at http://localhost:${PORT}`));
