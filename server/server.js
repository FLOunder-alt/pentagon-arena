const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const M = require('./map');
const CFG = require('./config');
const match = require('./match');
const chat = require('./chat');
const { LEVELS } = require('./bots');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.static(path.join(__dirname, '..', 'client')));
console.log(`Map: ${M.obstacles.length} obstacles, ${M.bushes.length} hiding spots, ${M.deadEnds.length} dead ends, ${M.walls.length} wall segments`);

/* ================= Rooms ================= */
const rooms = new Map(); // key(lowercase name) -> room
const keyOf = n => String(n || '').trim().toLowerCase();
const humans = r => [...r.players.values()].filter(p => !p.bot);
const roomInfo = r => ({
  name: r.name, max: r.max, hostId: r.hostId, state: r.state,
  players: [...r.players.values()].map(p => ({ id: p.id, username: p.username, color: p.color, bot: p.bot }))
});
const pushRoom = r => io.to(r.sid).emit('roomUpdate', roomInfo(r));
const pushList = () => io.emit('roomList', [...rooms.values()].filter(r => r.isPublic).map(r => {
  const n = humans(r).length;
  return { name: r.name, count: n, bots: r.players.size - n, max: r.max, locked: !!r.password, state: r.state };
}));

function addPlayer(r, socket) {
  const a = socket.data.acc;
  r.players.set(socket.id, match.makePlayer(socket.id, a.username, a.color));
  socket.join(r.sid); socket.data.room = r.key;
}

const BOT_NAMES = ['Ada', 'Bolt', 'Cleo', 'Dash', 'Echo', 'Fang', 'Gizmo', 'Hex', 'Iris', 'Juno'];
const BOT_COLORS = ['#e5534b', '#4fd36b', '#ffd23f', '#b27cff', '#ff8fc7', '#37d4cf', '#ff9142', '#c3cbd9'];
let botSeq = 0;
function addBot(r, level) {
  const taken = new Set([...r.players.values()].map(p => p.username));
  const free = BOT_NAMES.filter(n => !taken.has('Bot ' + n));
  const name = 'Bot ' + free[Math.random() * free.length | 0];
  const used = new Set([...r.players.values()].map(p => p.color));
  const color = BOT_COLORS.find(c => !used.has(c)) || BOT_COLORS[0];
  const id = `bot:${++botSeq}`;
  r.players.set(id, match.makePlayer(id, name, color, level));
}

function removePlayer(r, id) {
  const p = r.players.get(id);
  if (!p) return;
  match.leave(r, p);
  r.players.delete(id);
  const s = io.sockets.sockets.get(id);
  if (s) { s.leave(r.sid); s.data.room = null; }
  if (r.state === 'playing') match.finish(r);
  pushRoom(r); pushList();
}
function closeRoom(r) {
  io.to(r.sid).emit('roomClosed');
  for (const id of r.players.keys()) { const s = io.sockets.sockets.get(id); if (s) { s.leave(r.sid); s.data.room = null; } }
  rooms.delete(r.key); pushList();
}

function startGame(r) {
  match.start(r);
  io.to(r.sid).emit('gameStart', { map: M.MAP });
  pushRoom(r); pushList();
}

setInterval(() => {
  for (const r of rooms.values()) {
    if (r.state !== 'playing') continue;
    try { match.tick(r, 1 / CFG.TICK_RATE); }
    catch (e) { console.error(`Match error in room "${r.name}":`, e); closeRoom(r); }
  }
}, 1000 / CFG.TICK_RATE);

/* ================= Sockets ================= */
io.on('connection', socket => {
  const myRoom = () => rooms.get(socket.data.room);
  const hostRoom = () => { const r = myRoom(); return r && r.hostId === socket.id ? r : null; };
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
    r.net = {
      all: (ev, data) => io.to(r.sid).emit(ev, data),
      to: (id, ev, data) => io.to(id).emit(ev, data),
      ended: () => { pushRoom(r); pushList(); }
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
    if (r.players.size >= r.max) {
      const bot = [...r.players.values()].reverse().find(p => p.bot);
      if (!bot) return cb({ ok: false, error: 'Room is full.' });
      r.players.delete(bot.id); // a human takes the bot's slot
    }
    addPlayer(r, socket); pushRoom(r); pushList(); cb({ ok: true });
  });

  socket.on('addBot', level => {
    const r = hostRoom();
    if (!r || r.state !== 'lobby') return;
    if (r.players.size >= r.max) return socket.emit('toast', 'Room is full.');
    addBot(r, Object.hasOwn(LEVELS, level) ? level : 'normal');
    pushRoom(r); pushList();
  });

  socket.on('leaveRoom', () => {
    const r = myRoom(); if (!r) return;
    if (r.hostId === socket.id) closeRoom(r); else removePlayer(r, socket.id);
  });
  socket.on('closeRoom', () => { const r = hostRoom(); if (r) closeRoom(r); });
  socket.on('kick', id => {
    const r = hostRoom();
    if (!r || id === socket.id || !r.players.has(id)) return;
    io.to(id).emit('kicked'); removePlayer(r, id);
  });
  socket.on('startGame', () => {
    const r = hostRoom();
    if (!r || r.state !== 'lobby') return;
    if (r.players.size < 2) return socket.emit('toast', 'Need at least 2 players (add a bot to play solo).');
    startGame(r);
  });
  socket.on('input', d => {
    const r = myRoom(); if (!r || !d) return;
    const p = r.players.get(socket.id); if (!p) return;
    p.inp = { dx: clamp(d.dx), dy: clamp(d.dy), a: Number.isFinite(+d.a) ? +d.a : 0, s: !!d.s };
  });
  socket.on('dash', () => {
    const r = myRoom(); if (!r || r.state !== 'playing') return;
    const p = r.players.get(socket.id); if (p) match.dash(r, p);
  });
  socket.on('chat', text => {
    const r = myRoom(); if (!r) return;
    const p = r.players.get(socket.id); if (p) chat.handle(r, p, text);
  });
  socket.on('disconnect', () => {
    const r = myRoom(); if (!r) return;
    if (r.hostId === socket.id) closeRoom(r); else removePlayer(r, socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Pentagon Arena running at http://localhost:${PORT}`));
