const $ = s => document.querySelector(s);
const socket = io();
const LS_ACC = 'arena_account', LS_ROOMS = 'arena_rooms';

let acc = JSON.parse(localStorage.getItem(LS_ACC) || 'null');
let room = null, myCfg = null, inGame = false, map = null, S = null;

const saveAcc = () => localStorage.setItem(LS_ACC, JSON.stringify(acc));
const getRooms = () => JSON.parse(localStorage.getItem(LS_ROOMS) || '[]');
const setRooms = r => localStorage.setItem(LS_ROOMS, JSON.stringify(r));
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function show(id) {
  document.querySelectorAll('.screen').forEach(e => e.classList.add('hidden'));
  $('#' + id).classList.remove('hidden');
}
let toastT;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.add('hidden'), 3000);
}

/* ---------------- Account ---------------- */
function renderMe() {
  $('#me').innerHTML = `<span class="dot" style="background:${esc(acc.color)}"></span><b>${esc(acc.username)}</b>
    <span class="muted" style="margin:0">Kills ${acc.kills} &middot; Wins ${acc.wins}</span>`;
}
function register() {
  socket.emit('register', acc, res => {
    if (!res) return;
    acc.username = res.username;
    saveAcc(); renderMe();
  });
}
$('#accountForm').addEventListener('submit', e => {
  e.preventDefault();
  const username = $('#acc-name').value.trim();
  if (username.length < 2) return toast('Username needs at least 2 characters.');
  acc = { username, color: $('#acc-color').value, kills: 0, wins: 0 };
  saveAcc(); renderMe(); register(); renderMyRooms(); show('lobby');
});
$('#resetAcc').addEventListener('click', () => {
  if (!confirm('Delete this account (name, color, kills, wins) from this browser?')) return;
  localStorage.removeItem(LS_ACC); acc = null; show('account');
});

/* ---------------- Lobby ---------------- */
function renderRoomList(list) {
  $('#roomList').innerHTML = list.length ? list.map(r => `
    <div class="item"><span class="grow">${esc(r.name)} ${r.locked ? '🔒' : ''}</span>
      <span class="muted" style="margin:0">${r.count}/${r.max}${r.state !== 'lobby' ? ' · playing' : ''}</span>
      <button class="small" data-act="join" data-name="${esc(r.name)}" data-locked="${r.locked}" ${r.state !== 'lobby' || r.count >= r.max ? 'disabled' : ''}>Join</button>
    </div>`).join('') : '<div class="empty">No public rooms yet. Create one!</div>';
}
function renderMyRooms() {
  const rs = getRooms();
  $('#myRooms').innerHTML = rs.length ? rs.map((r, i) => `
    <div class="item"><span class="grow">${esc(r.name)} <span class="muted">(${r.max} max, ${r.isPublic ? 'public' : 'private'})</span></span>
      <button class="small" data-act="reopen" data-i="${i}">Reopen</button>
      <button class="small danger" data-act="delete" data-i="${i}">Delete</button>
    </div>`).join('') : '<div class="empty">Rooms you close are saved here.</div>';
}
function enterRoomAck(res) {
  if (!res.ok) { myCfg = null; return toast(res.error); }
  show('room');
}
function createRoom(cfg) { myCfg = cfg; socket.emit('createRoom', cfg, enterRoomAck); }
function joinRoom(name, password) { socket.emit('joinRoom', { name, password }, enterRoomAck); }

$('#createForm').addEventListener('submit', e => {
  e.preventDefault();
  createRoom({ name: $('#cr-name').value.trim(), max: +$('#cr-max').value, password: $('#cr-pass').value, isPublic: $('#cr-pub').value === '1' });
});
$('#joinForm').addEventListener('submit', e => { e.preventDefault(); joinRoom($('#j-name').value, $('#j-pass').value); });

document.addEventListener('click', e => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const act = b.dataset.act;
  if (act === 'join') {
    const pw = b.dataset.locked === 'true' ? prompt('Room password:') : '';
    if (pw !== null) joinRoom(b.dataset.name, pw);
  } else if (act === 'kick') socket.emit('kick', b.dataset.id);
  else if (act === 'reopen') {
    const rs = getRooms(), cfg = rs[+b.dataset.i]; if (!cfg) return;
    myCfg = cfg;
    socket.emit('createRoom', cfg, res => {
      if (!res.ok) { myCfg = null; return toast(res.error); }
      rs.splice(+b.dataset.i, 1); setRooms(rs); renderMyRooms(); show('room');
    });
  } else if (act === 'delete') {
    const rs = getRooms(); rs.splice(+b.dataset.i, 1); setRooms(rs); renderMyRooms();
  }
});

/* ---------------- Room screen ---------------- */
function renderRoom() {
  if (!room) return;
  const host = room.hostId === socket.id;
  $('#roomTitle').textContent = room.name;
  $('#roomSub').textContent = `${room.players.length}/${room.max} players` + (host ? ' · you are the host' : ' · waiting for the host to start');
  $('#players').innerHTML = room.players.map(p => `
    <div class="item"><span class="dot" style="background:${esc(p.color)}"></span>
      <span class="grow">${esc(p.username)} ${p.id === room.hostId ? '👑' : ''}</span>
      ${host && p.id !== socket.id ? `<button class="small danger" data-act="kick" data-id="${esc(p.id)}">Kick</button>` : ''}
    </div>`).join('');
  $('#startBtn').classList.toggle('hidden', !host);
  $('#closeBtn').classList.toggle('hidden', !host);
  $('#leaveBtn').classList.toggle('hidden', host);
  $('#startBtn').disabled = room.players.length < 2;
}
$('#startBtn').addEventListener('click', () => socket.emit('startGame'));
$('#closeBtn').addEventListener('click', () => socket.emit('closeRoom'));
$('#leaveBtn').addEventListener('click', () => { socket.emit('leaveRoom'); room = null; show('lobby'); });

/* ---------------- Socket events ---------------- */
socket.on('connect', () => { if (acc) register(); });
socket.on('disconnect', () => { room = null; inGame = false; if (acc) { show('lobby'); toast('Disconnected from server.'); } });
socket.on('toast', toast);
socket.on('roomList', renderRoomList);
socket.on('statsAdd', d => { acc.kills += d.kills || 0; acc.wins += d.wins || 0; saveAcc(); renderMe(); });
socket.on('roomUpdate', r => {
  room = r;
  if (inGame && r.state === 'lobby') { inGame = false; show('room'); }
  renderRoom();
});
socket.on('kicked', () => { room = null; inGame = false; show('lobby'); toast('You were kicked from the room.'); });
socket.on('roomClosed', () => {
  const wasHost = room && room.hostId === socket.id;
  if (wasHost && myCfg) {
    const rs = getRooms().filter(r => r.name.toLowerCase() !== myCfg.name.toLowerCase());
    rs.push(myCfg); setRooms(rs); renderMyRooms();
  } else toast('The host closed the room.');
  room = null; myCfg = wasHost ? null : myCfg; inGame = false; show('lobby');
});
socket.on('gameStart', d => {
  map = d.map; S = null; inGame = true;
  Object.keys(view).forEach(k => delete view[k]);
  $('#banner').classList.add('hidden'); $('#feed').innerHTML = '';
  show('game'); resize(); requestAnimationFrame(frame);
});
socket.on('feed', d => {
  const el = document.createElement('div'); el.textContent = d.text; $('#feed').appendChild(el);
  setTimeout(() => el.remove(), 6000);
});
socket.on('gameOver', d => {
  const b = $('#banner'); b.textContent = d.winner ? `Winner: ${d.winner}` : 'Draw'; b.classList.remove('hidden');
});
socket.on('state', s => {
  S = s;
  const me = s.p.find(p => p.id === socket.id);
  if (me) {
    $('#hpFill').style.width = me.hp + '%'; $('#hpTxt').textContent = me.hp + ' HP';
    $('#dmg').textContent = me.d; $('#kills').textContent = me.k;
    $('#cdFill').style.width = (100 * (1 - me.cd / me.cm)) + '%';
    $('#mode').textContent = me.al ? '' : 'Ghost: spectating the whole map (no attacks)';
  }
  $('#alive').textContent = s.alive;
});

/* ---------------- Input ---------------- */
const keys = {}, mouse = { x: 0, y: 0, down: false };
const cv = $('#c'), ctx = cv.getContext('2d');
addEventListener('keydown', e => { keys[e.code] = true; if (inGame && e.code.startsWith('Arrow')) e.preventDefault(); });
addEventListener('keyup', e => { keys[e.code] = false; });
cv.addEventListener('mousemove', e => { mouse.x = e.clientX; mouse.y = e.clientY; });
cv.addEventListener('mousedown', e => { mouse.x = e.clientX; mouse.y = e.clientY; mouse.down = true; });
addEventListener('mouseup', () => { mouse.down = false; });
cv.addEventListener('contextmenu', e => e.preventDefault());
setInterval(() => {
  if (!inGame) return;
  const dx = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0);
  const dy = (keys.KeyS || keys.ArrowDown ? 1 : 0) - (keys.KeyW || keys.ArrowUp ? 1 : 0);
  socket.emit('input', { dx, dy, a: Math.atan2(mouse.y - cv.height / 2, mouse.x - cv.width / 2), s: mouse.down });
}, 33);

/* ---------------- Rendering ---------------- */
const view = {}; // smoothed render positions
function resize() { cv.width = innerWidth; cv.height = innerHeight; }
addEventListener('resize', resize);
const POWER = { power: ['#ff5a4f', 'x2'], agility: ['#ffd23f', 'A'], food: ['#4fd36b', '+'] };

function frame() {
  if (!inGame) return;
  requestAnimationFrame(frame);
  const W = cv.width, H = cv.height;
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#070a11'; ctx.fillRect(0, 0, W, H);
  if (!S || !map) return;

  for (const p of S.p) {
    let v = view[p.id];
    if (!v || Math.hypot(v.x - p.x, v.y - p.y) > 150) v = view[p.id] = { x: p.x, y: p.y };
    v.x += (p.x - v.x) * .4; v.y += (p.y - v.y) * .4;
  }
  const me = S.p.find(p => p.id === socket.id);
  const ghost = !me || !me.al;
  let sc, cx, cy;
  if (ghost) { sc = Math.min(W / 1850, H / 1750); cx = 1000; cy = 920; } // whole map
  else { sc = Math.min(W, H) / 800; cx = view[me.id].x; cy = view[me.id].y; }
  ctx.setTransform(sc, 0, 0, sc, W / 2 - cx * sc, H / 2 - cy * sc);

  // floor
  ctx.beginPath(); map.verts.forEach((v, i) => i ? ctx.lineTo(v.x, v.y) : ctx.moveTo(v.x, v.y)); ctx.closePath();
  ctx.fillStyle = '#1c2230'; ctx.fill(); ctx.lineWidth = 10; ctx.strokeStyle = '#59627a'; ctx.stroke();
  ctx.fillStyle = '#151a26'; map.deadEnds.forEach(d => ctx.fillRect(d.x, d.y, d.w, d.h));
  // walls & obstacles
  ctx.fillStyle = '#59627a'; map.walls.forEach(w => ctx.fillRect(w.x, w.y, w.w, w.h));
  ctx.fillStyle = '#8a6f4a'; map.obstacles.forEach(w => ctx.fillRect(w.x, w.y, w.w, w.h));
  // powerups
  ctx.font = 'bold 13px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const w of S.pw) {
    const [col, txt] = POWER[w.t];
    ctx.beginPath(); ctx.arc(w.x, w.y, 14, 0, 7); ctx.fillStyle = col; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = '#fff'; ctx.stroke(); ctx.fillStyle = '#111'; ctx.fillText(txt, w.x, w.y + 1);
  }
  // arrows
  ctx.lineWidth = 3; ctx.strokeStyle = '#f5e6b8';
  for (const a of S.ar) {
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(a.x - Math.cos(a.a) * 22, a.y - Math.sin(a.a) * 22); ctx.stroke();
  }
  // players
  for (const p of S.p) {
    const v = view[p.id];
    ctx.globalAlpha = p.al ? 1 : .35;
    ctx.beginPath(); ctx.moveTo(v.x, v.y); ctx.lineTo(v.x + Math.cos(p.a) * 30, v.y + Math.sin(p.a) * 30);
    ctx.lineWidth = 4; ctx.strokeStyle = '#c9a36b'; ctx.stroke(); // bow
    ctx.beginPath(); ctx.arc(v.x, v.y, 16, 0, 7); ctx.fillStyle = p.c; ctx.fill();
    ctx.lineWidth = p.id === socket.id ? 4 : 2; ctx.strokeStyle = p.id === socket.id ? '#fff' : '#0008'; ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.font = '13px sans-serif'; ctx.fillText(p.n + (p.al ? '' : ' (ghost)'), v.x, v.y - 30);
    if (p.al) {
      ctx.fillStyle = '#000a'; ctx.fillRect(v.x - 18, v.y - 25, 36, 5);
      ctx.fillStyle = p.hp > 40 ? '#4fd36b' : '#e5534b'; ctx.fillRect(v.x - 18, v.y - 25, 36 * p.hp / 100, 5);
    }
    ctx.globalAlpha = 1;
  }
  // hiding spots drawn over players (cover)
  map.bushes.forEach(b => {
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, 7);
    ctx.fillStyle = '#2f8f4acc'; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = '#1d6b34'; ctx.stroke();
  });
}

/* ---------------- Boot ---------------- */
renderMyRooms();
if (acc) { renderMe(); show('lobby'); } else show('account');
