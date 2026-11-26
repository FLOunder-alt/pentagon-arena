const $ = s => document.querySelector(s);
const socket = io();
const LS_ACC = 'arena_account', LS_ROOMS = 'arena_rooms';

let acc = JSON.parse(localStorage.getItem(LS_ACC) || 'null');
let room = null, myCfg = null, inGame = false, matchOver = false, map = null, S = null;

const saveAcc = () => localStorage.setItem(LS_ACC, JSON.stringify(acc));
const getRooms = () => JSON.parse(localStorage.getItem(LS_ROOMS) || '[]');
const setRooms = r => localStorage.setItem(LS_ROOMS, JSON.stringify(r));
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const el = (tag, text, cls) => { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (cls) e.className = cls; return e; };
const dot = color => { const d = el('span', undefined, 'dot'); d.style.background = color; return d; };
const mmss = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

let screen = 'account';
function show(id) {
  screen = id;
  document.querySelectorAll('.screen').forEach(e => e.classList.add('hidden'));
  $('#' + id).classList.remove('hidden');
  $('#chat').classList.toggle('hidden', !(room || inGame) || (id !== 'room' && id !== 'game'));
  updateChatMode();
}
let toastT;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.add('hidden'), 3000);
}

/* ---------------- Sound ---------------- */
const renderSoundBtn = () => { $('#soundBtn').textContent = `Sound: ${Sound.muted ? 'off' : 'on'}`; };
function toggleSound() { Sound.toggle(); renderSoundBtn(); }
addEventListener('pointerdown', Sound.unlock);
addEventListener('keydown', Sound.unlock);
$('#soundBtn').addEventListener('click', e => { toggleSound(); e.currentTarget.blur(); });
renderSoundBtn();

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
      <span class="muted" style="margin:0">${r.count}/${r.max}${r.bots ? ` · ${r.bots} bot${r.bots > 1 ? 's' : ''}` : ''}${r.state !== 'lobby' ? ' · playing' : ''}</span>
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
// The server sends roomUpdate before the create/join ack, so the room is already filled in here.
function enterRoomAck(res) {
  if (!res.ok) { myCfg = null; return toast(res.error); }
  show('room');
}
function createRoom(cfg) { clearChat(); myCfg = cfg; socket.emit('createRoom', cfg, enterRoomAck); }
function joinRoom(name, password) { clearChat(); socket.emit('joinRoom', { name, password }, enterRoomAck); }
function leaveToLobby() {
  room = null; stopGame(); clearChat(); show('lobby');
}

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
    myCfg = cfg; clearChat();
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
      <span class="grow">${esc(p.username)} ${p.id === room.hostId ? '👑' : ''}${p.bot ? `<span class="tag">BOT · ${esc(p.bot.toUpperCase())}</span>` : ''}</span>
      ${host && p.id !== socket.id ? `<button class="small danger" data-act="kick" data-id="${esc(p.id)}">${p.bot ? 'Remove' : 'Kick'}</button>` : ''}
    </div>`).join('');
  $('#startBtn').classList.toggle('hidden', !host);
  $('#closeBtn').classList.toggle('hidden', !host);
  $('#leaveBtn').classList.toggle('hidden', host);
  $('#botRow').classList.toggle('hidden', !host);
  $('#addBotBtn').disabled = room.players.length >= room.max;
  $('#startBtn').disabled = $('#againBtn').disabled = room.players.length < 2 || room.state !== 'lobby';
  $('#againBtn').classList.toggle('hidden', !host);
}
$('#addBotBtn').addEventListener('click', () => socket.emit('addBot', $('#botLevel').value));
$('#startBtn').addEventListener('click', e => { e.currentTarget.blur(); socket.emit('startGame'); });
$('#againBtn').addEventListener('click', e => { e.currentTarget.blur(); socket.emit('startGame'); });
$('#backBtn').addEventListener('click', () => { stopGame(); show('room'); });
$('#closeBtn').addEventListener('click', () => socket.emit('closeRoom'));
$('#leaveBtn').addEventListener('click', () => { socket.emit('leaveRoom'); leaveToLobby(); });

/* ---------------- Chat ---------------- */
const chatInput = $('#chatInput');
const typing = () => /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement && document.activeElement.tagName);
const amGhost = () => { const me = inGame && !matchOver && S && S.p.find(p => p.id === socket.id); return !!me && !me.al; };

function clearChat() { $('#chatLog').textContent = ''; chatInput.value = ''; }
function updateChatMode() {
  const ghost = amGhost();
  $('#chat').classList.toggle('ghost', ghost);
  chatInput.placeholder = ghost ? 'Ghost chat: only eliminated players see this'
    : inGame && !matchOver ? 'Press Enter to chat with everyone' : 'Press Enter to chat';
}
socket.on('chat', m => {
  const line = el('div', undefined, m.channel === 'ghost' ? 'ghost' : '');
  const name = el('b', (m.channel === 'ghost' ? '[Ghost] ' : '') + m.name + ':'); name.style.color = m.color;
  line.append(name, document.createTextNode(m.text));
  const log = $('#chatLog'); log.appendChild(line);
  while (log.children.length > 40) log.firstChild.remove();
  log.scrollTop = log.scrollHeight;
  if (m.id !== socket.id) Sound.play('chat');
});
$('#chatForm').addEventListener('submit', e => {
  e.preventDefault();
  const text = chatInput.value.trim();
  if (text) socket.emit('chat', text);
  chatInput.value = ''; chatInput.blur();
});
chatInput.addEventListener('focus', () => releaseKeys());
chatInput.addEventListener('keydown', e => { if (e.key === 'Escape') { chatInput.value = ''; chatInput.blur(); } });

/* ---------------- Socket events ---------------- */
socket.on('connect', () => { if (acc) register(); });
socket.on('disconnect', () => { if (acc) { leaveToLobby(); toast('Disconnected from server.'); } });
socket.on('toast', toast);
socket.on('roomList', renderRoomList);
socket.on('statsAdd', d => { acc.kills += d.kills || 0; acc.wins += d.wins || 0; saveAcc(); renderMe(); });
socket.on('roomUpdate', r => { room = r; renderRoom(); });
socket.on('kicked', () => { leaveToLobby(); toast('You were kicked from the room.'); });
socket.on('roomClosed', () => {
  const wasHost = room && room.hostId === socket.id;
  if (wasHost && myCfg) {
    const rs = getRooms().filter(r => r.name.toLowerCase() !== myCfg.name.toLowerCase());
    rs.push(myCfg); setRooms(rs); renderMyRooms();
  } else toast('The host closed the room.');
  myCfg = wasHost ? null : myCfg; leaveToLobby();
});

let rafId = 0, announceT, lastZone = null, lastStormSound = 0, flashUntil = 0;
function announce(text, ms = 2500) {
  const a = $('#announce'); a.textContent = text; a.classList.remove('hidden');
  clearTimeout(announceT); announceT = setTimeout(() => a.classList.add('hidden'), ms);
}
function stopGame() {
  inGame = false; matchOver = false; S = null;
  cancelAnimationFrame(rafId); releaseKeys();
  ['#results', '#announce', '#vignette'].forEach(s => $(s).classList.add('hidden'));
}

socket.on('gameStart', d => {
  stopGame();
  map = d.map; inGame = true; lastZone = null; flashUntil = 0;
  Object.keys(view).forEach(k => delete view[k]);
  trails.length = 0;
  $('#feed').textContent = ''; $('#zoneInfo').textContent = '';
  if (document.activeElement && !typing()) document.activeElement.blur();
  show('game'); resize(); rafId = requestAnimationFrame(frame);
  announce('Fight! Stay inside the storm circle.'); Sound.play('start');
});

socket.on('feed', d => {
  if (!inGame) return;
  const line = el('div');
  const who = p => { const s = el('b', p.name + (p.bot ? ' (bot)' : '')); s.style.color = p.color; return s; };
  if (d.cause === 'arrow' && d.killer) line.append(who(d.killer), el('span', '➶', 'how'), who(d.victim));
  else line.append(who(d.victim), el('span', d.cause === 'storm' ? 'was taken by the storm' : d.cause === 'left' ? 'left the match' : 'was eliminated', 'how'));
  line.append(el('span', `#${d.place} · ${d.alive} left`, 'place'));
  const mineKill = d.killer && d.killer.id === socket.id, mineDeath = d.victim.id === socket.id;
  if (mineKill || mineDeath) line.className = 'mine';
  const feed = $('#feed'); feed.appendChild(line);
  while (feed.children.length > 6) feed.firstChild.remove();
  setTimeout(() => line.remove(), 7000);

  if (mineDeath) {
    Sound.play('death');
    if (d.alive > 1) announce(`Eliminated! You placed #${d.place} of ${d.total}. Spectating.`, 4500);
  } else if (mineKill) { Sound.play('kill'); announce(`You eliminated ${d.victim.name}`, 1800); }
  else Sound.play('elim', .6);
});

const ordinal = n => n + (['th', 'st', 'nd', 'rd'][(n % 100 - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th');
socket.on('gameOver', d => {
  if (!inGame) return;
  matchOver = true; releaseKeys();
  const mine = d.results.find(r => r.id === socket.id), won = d.winnerId === socket.id;
  $('#resTitle').textContent = won ? 'Victory!' : d.winner ? `${d.winner} wins` : 'Draw';
  $('#resSub').textContent = (mine ? `You placed ${ordinal(mine.place)} of ${d.results.length}. ` : '') + `Match length ${mmss(d.duration)}.`;
  const rows = $('#resRows'); rows.textContent = '';
  for (const r of d.results) {
    const tr = el('tr', undefined, [r.id === socket.id ? 'mine' : '', r.place === 1 ? 'first' : ''].join(' ').trim());
    const name = el('td'); name.append(dot(r.color), document.createTextNode(r.name));
    if (r.bot) name.append(el('span', 'BOT', 'tag'));
    tr.append(el('td', `#${r.place}`), name, el('td', r.kills), el('td', r.dmg), el('td', mmss(r.time)));
    rows.appendChild(tr);
  }
  $('#announce').classList.add('hidden'); $('#vignette').classList.add('hidden');
  $('#results').classList.remove('hidden');
  renderRoom(); updateChatMode();
  Sound.play(won ? 'victory' : 'defeat');
});

socket.on('state', s => {
  if (!inGame || matchOver) return;
  S = s;
  const me = s.p.find(p => p.id === socket.id);
  if (me) {
    $('#hpFill').style.width = me.hp + '%'; $('#hpTxt').textContent = me.hp + ' HP';
    $('#shFill').style.width = (100 * me.sh / 60) + '%'; $('#shTxt').textContent = 'Shield ' + me.sh;
    $('#dmg').textContent = me.d; $('#kills').textContent = me.k;
    $('#cdFill').style.width = (100 * (1 - me.cd / me.cm)) + '%';
    $('#dashFill').style.width = (100 * (1 - me.dc / me.dm)) + '%';
    renderBuffs(me.fx);
    $('#mode').textContent = me.al ? '' : 'Ghost: spectating the whole map (no attacks)';
  }
  $('#alive').textContent = `${s.alive}/${s.total}`;
  renderZone(s.zone, me);
  playEvents(s.ev, me);
  updateChatMode();
});

function renderBuffs(fx) {
  const box = $('#buffs'); box.textContent = '';
  for (const [key, label] of [['haste', 'Speed'], ['multi', 'Triple shot'], ['ricochet', 'Ricochet']]) {
    if (!fx[key]) continue;
    const s = el('span', `${label} ${Math.ceil(fx[key] / 1000)}s`); s.style.background = POWER[key][0]; box.appendChild(s);
  }
}

function renderZone(z, me) {
  const out = !!me && me.al && (z.r < 1 || Math.hypot(me.x - z.x, me.y - z.y) > z.r);
  const info = $('#zoneInfo');
  const status = z.mode === 'wait' ? `Storm moves in ${mmss(z.left)}` : z.mode === 'shrink' ? `Storm closing: ${mmss(z.left)}` : 'Final storm';
  info.textContent = out ? `In the storm! -${z.dps} HP/s · ${status}` : `Zone ${z.phase}/${z.phases} · ${status}`;
  info.classList.toggle('danger', out);
  $('#vignette').classList.toggle('hidden', !out);
  const key = `${z.phase}:${z.mode}`;
  if (lastZone && key !== lastZone && z.mode === 'shrink') { announce('The storm is closing in!'); Sound.play('warning'); }
  lastZone = key;
}

const PICKUP_TEXT = { power: 'Double damage!', agility: 'Faster attacks!', food: '+10 HP', shield: '+30 shield', haste: 'Speed boost!', multi: 'Triple shot!', ricochet: 'Ricochet arrows!' };
function playEvents(events, me) {
  // Sounds get quieter with distance from your fighter (ghosts hear everything softly).
  const vol = e => !me || !me.al ? .35 : e.id === socket.id ? 1 : e.x === undefined ? .3 : Math.max(0, 1 - Math.hypot(e.x - me.x, e.y - me.y) / 800) * .8;
  for (const e of events) {
    if (e.t === 'shot') Sound.play('shot', vol(e));
    else if (e.t === 'dash') Sound.play('dash', vol(e));
    else if (e.t === 'hit') {
      if (e.id === socket.id) { Sound.play(e.sh ? 'shield' : 'hurt'); flashUntil = performance.now() + 180; }
      else if (e.by === socket.id) Sound.play('hitmark');
    } else if (e.t === 'pickup') {
      Sound.play('pickup', vol(e));
      if (e.id === socket.id) announce(PICKUP_TEXT[e.k], 1200);
    } else if (e.t === 'storm' && performance.now() - lastStormSound > 900) { lastStormSound = performance.now(); Sound.play('storm', .7); }
  }
}

/* ---------------- Input ---------------- */
const keys = {}, mouse = { x: 0, y: 0, down: false };
const cv = $('#c'), ctx = cv.getContext('2d');
function releaseKeys() { Object.keys(keys).forEach(k => delete keys[k]); mouse.down = false; }
addEventListener('keydown', e => {
  if (typing()) return;
  const onButton = document.activeElement && document.activeElement.tagName === 'BUTTON';
  if ((e.code === 'Enter' || e.code === 'NumpadEnter') && !onButton && !$('#chat').classList.contains('hidden')) { e.preventDefault(); chatInput.focus(); return; }
  if (e.code === 'KeyM' && !e.repeat && !e.ctrlKey && !e.metaKey) toggleSound();
  keys[e.code] = true;
  if (!inGame || matchOver) return;
  if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
  if (e.code === 'Space' && !e.repeat) socket.emit('dash');
});
addEventListener('keyup', e => { keys[e.code] = false; });
addEventListener('blur', releaseKeys);
cv.addEventListener('mousemove', e => { mouse.x = e.clientX; mouse.y = e.clientY; });
cv.addEventListener('mousedown', e => {
  e.preventDefault();
  if (typing()) document.activeElement.blur();
  mouse.x = e.clientX; mouse.y = e.clientY;
  if (e.button === 0) mouse.down = true;
  else if (e.button === 2) socket.emit('dash');
});
addEventListener('mouseup', e => { if (e.button === 0) mouse.down = false; });
cv.addEventListener('contextmenu', e => e.preventDefault());
setInterval(() => {
  if (!inGame || matchOver) return;
  const dx = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0);
  const dy = (keys.KeyS || keys.ArrowDown ? 1 : 0) - (keys.KeyW || keys.ArrowUp ? 1 : 0);
  socket.emit('input', { dx, dy, a: Math.atan2(mouse.y - cv.height / 2, mouse.x - cv.width / 2), s: mouse.down });
}, 33);

/* ---------------- Rendering ---------------- */
const view = {}; // smoothed render positions
const trails = []; // dash after-images
function resize() { cv.width = innerWidth; cv.height = innerHeight; }
addEventListener('resize', resize);
const POWER = {
  power: ['#ff5a4f', 'x2'], agility: ['#ffd23f', 'A'], food: ['#4fd36b', '+'], shield: ['#55c8ff', 'S'],
  haste: ['#ff9bd2', '»'], multi: ['#ff9f43', '3'], ricochet: ['#c4a7ff', 'R']
};
const circle = (c, x, y, r) => { c.beginPath(); c.arc(x, y, Math.max(0, r), 0, Math.PI * 2); };
function pentagon(c) { c.beginPath(); map.verts.forEach((v, i) => i ? c.lineTo(v.x, v.y) : c.moveTo(v.x, v.y)); c.closePath(); }

function drawStorm(c, z, edge) {
  c.save(); pentagon(c); c.clip();
  c.beginPath(); c.rect(0, 0, 2000, 2000); c.arc(z.x, z.y, z.r, 0, Math.PI * 2, true);
  c.fillStyle = '#7a22b866'; c.fill('evenodd'); c.restore();
  if (z.r > 0) { circle(c, z.x, z.y, z.r); c.lineWidth = edge; c.strokeStyle = '#d68bff'; c.stroke(); }
  if (z.next && z.next.r > 0) {
    c.setLineDash([edge * 3, edge * 2]); circle(c, z.next.x, z.next.y, z.next.r);
    c.lineWidth = edge * .8; c.strokeStyle = '#ffffffcc'; c.stroke(); c.setLineDash([]);
  }
}

function frame() {
  if (!inGame) return;
  rafId = requestAnimationFrame(frame);
  const W = cv.width, H = cv.height, now = performance.now();
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#070a11'; ctx.fillRect(0, 0, W, H);
  if (!S || !map) return;

  for (const p of S.p) {
    let v = view[p.id];
    if (!v || Math.hypot(v.x - p.x, v.y - p.y) > 150) v = view[p.id] = { x: p.x, y: p.y };
    const k = p.ds ? .7 : .4;
    v.x += (p.x - v.x) * k; v.y += (p.y - v.y) * k;
    if (p.ds) trails.push({ x: v.x, y: v.y, c: p.c, t: now });
  }
  while (trails.length && now - trails[0].t > 220) trails.shift();
  const me = S.p.find(p => p.id === socket.id);
  const ghost = !me || !me.al;
  let sc, cx, cy;
  if (ghost) { sc = Math.min(W / 1850, H / 1750); cx = 1000; cy = 920; } // whole map
  else { sc = Math.min(W, H) / 800; cx = view[me.id].x; cy = view[me.id].y; }
  ctx.setTransform(sc, 0, 0, sc, W / 2 - cx * sc, H / 2 - cy * sc);

  // floor
  pentagon(ctx);
  ctx.fillStyle = '#1c2230'; ctx.fill(); ctx.lineWidth = 10; ctx.strokeStyle = '#59627a'; ctx.stroke();
  ctx.fillStyle = '#151a26'; map.deadEnds.forEach(d => ctx.fillRect(d.x, d.y, d.w, d.h));
  // walls & obstacles
  ctx.fillStyle = '#59627a'; map.walls.forEach(w => ctx.fillRect(w.x, w.y, w.w, w.h));
  ctx.fillStyle = '#8a6f4a'; map.obstacles.forEach(w => ctx.fillRect(w.x, w.y, w.w, w.h));
  // powerups
  ctx.font = 'bold 13px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const w of S.pw) {
    const [col, txt] = POWER[w.t];
    circle(ctx, w.x, w.y, 14 + Math.sin(now / 250 + w.id) * 1.5); ctx.fillStyle = col; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = '#fff'; ctx.stroke(); ctx.fillStyle = '#111'; ctx.fillText(txt, w.x, w.y + 1);
  }
  // arrows
  ctx.lineWidth = 3;
  for (const a of S.ar) {
    ctx.strokeStyle = a.b ? POWER.ricochet[0] : '#f5e6b8';
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(a.x - Math.cos(a.a) * 22, a.y - Math.sin(a.a) * 22); ctx.stroke();
  }
  // dash trails
  for (const t of trails) { ctx.globalAlpha = .3 * (1 - (now - t.t) / 220); circle(ctx, t.x, t.y, 14); ctx.fillStyle = t.c; ctx.fill(); }
  ctx.globalAlpha = 1;
  // players
  for (const p of S.p) {
    const v = view[p.id];
    ctx.globalAlpha = p.al ? 1 : .35;
    ctx.beginPath(); ctx.moveTo(v.x, v.y); ctx.lineTo(v.x + Math.cos(p.a) * 30, v.y + Math.sin(p.a) * 30);
    ctx.lineWidth = 4; ctx.strokeStyle = '#c9a36b'; ctx.stroke(); // bow
    circle(ctx, v.x, v.y, 16); ctx.fillStyle = p.c; ctx.fill();
    ctx.lineWidth = p.id === socket.id ? 4 : 2; ctx.strokeStyle = p.id === socket.id ? '#fff' : '#0008'; ctx.stroke();
    if (p.al && p.sh > 0) { circle(ctx, v.x, v.y, 22); ctx.lineWidth = 1 + p.sh / 20; ctx.strokeStyle = POWER.shield[0]; ctx.stroke(); }
    ctx.fillStyle = '#fff'; ctx.font = `${ghost ? Math.round(12 / sc) : 13}px sans-serif`; // stay readable when zoomed out
    ctx.fillText(p.n + (p.b ? ' [bot]' : '') + (p.al ? '' : ' (ghost)'), v.x, v.y - (ghost ? 28 + 6 / sc : 36));
    if (p.al) {
      ctx.fillStyle = '#000a'; ctx.fillRect(v.x - 18, v.y - 28, 36, 5);
      ctx.fillStyle = p.hp > 40 ? '#4fd36b' : '#e5534b'; ctx.fillRect(v.x - 18, v.y - 28, 36 * p.hp / 100, 5);
    }
    ctx.globalAlpha = 1;
  }
  // hiding spots drawn over players (cover)
  map.bushes.forEach(b => {
    circle(ctx, b.x, b.y, b.r);
    ctx.fillStyle = '#2f8f4acc'; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = '#1d6b34'; ctx.stroke();
  });
  drawStorm(ctx, S.zone, ghost ? 8 : 5);

  // arrow pointing back to safety
  if (!ghost && S.zone.next) {
    const n = S.zone.next, v = view[me.id];
    if (Math.hypot(v.x - n.x, v.y - n.y) > n.r) {
      const a = Math.atan2(n.y - v.y, n.x - v.x);
      ctx.save(); ctx.translate(v.x + Math.cos(a) * 62, v.y + Math.sin(a) * 62); ctx.rotate(a);
      ctx.beginPath(); ctx.moveTo(14, 0); ctx.lineTo(-8, -10); ctx.lineTo(-8, 10); ctx.closePath(); ctx.fillStyle = '#ffffffcc'; ctx.fill(); ctx.restore();
    }
  }
  if (now < flashUntil) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#e5534b33'; ctx.fillRect(0, 0, W, H); }
  drawMinimap(me, ghost, now);
}

/* ---------------- Minimap ---------------- */
const mm = $('#minimap'), mx = mm.getContext('2d');
const RADAR = 450; // living players see enemies this close (or who just fired) on the minimap

function drawMinimap(me, ghost, now) {
  const k = mm.width / 1800;
  mx.setTransform(1, 0, 0, 1, 0, 0); mx.clearRect(0, 0, mm.width, mm.height);
  mx.setTransform(k, 0, 0, k, -100 * k, -20 * k);
  pentagon(mx); mx.fillStyle = '#1c2230'; mx.fill(); mx.lineWidth = 14; mx.strokeStyle = '#59627a'; mx.stroke();
  mx.fillStyle = '#2f8f4a99'; map.bushes.forEach(b => { circle(mx, b.x, b.y, b.r); mx.fill(); });
  mx.fillStyle = '#7d869e'; map.walls.forEach(w => mx.fillRect(w.x, w.y, w.w, w.h));
  mx.fillStyle = '#8a6f4a'; map.obstacles.forEach(w => mx.fillRect(w.x, w.y, w.w, w.h));
  for (const w of S.pw) { mx.fillStyle = POWER[w.t][0]; mx.fillRect(w.x - 14, w.y - 14, 28, 28); }
  drawStorm(mx, S.zone, 12);
  for (const p of S.p) {
    if (!p.al || p.id === socket.id) continue;
    if (!ghost && !p.fired && Math.hypot(p.x - me.x, p.y - me.y) > RADAR) continue;
    circle(mx, p.x, p.y, 30); mx.fillStyle = p.c; mx.fill(); mx.lineWidth = 9; mx.strokeStyle = ghost ? '#000' : '#ff3b30'; mx.stroke();
  }
  if (me) {
    circle(mx, me.x, me.y, 34 + Math.sin(now / 200) * 5); mx.globalAlpha = me.al ? 1 : .5;
    mx.fillStyle = '#fff'; mx.fill(); mx.lineWidth = 12; mx.strokeStyle = me.c; mx.stroke(); mx.globalAlpha = 1;
  }
}

/* ---------------- Boot ---------------- */
renderMyRooms();
if (acc) { renderMe(); show('lobby'); } else show('account');
