/* Game-rule tests. Run with: npm test */
const test = require('node:test');
const assert = require('node:assert');
const M = require('../server/map');
const CFG = require('../server/config');
const match = require('../server/match');
const chat = require('../server/chat');

const DT = 1 / CFG.TICK_RATE;

function room(n, bot = null) {
  const r = { players: new Map(), state: 'lobby', sent: [] };
  r.net = {
    all: (ev, data) => r.sent.push({ to: '*', ev, data }),
    to: (id, ev, data) => r.sent.push({ to: id, ev, data }),
    ended: () => {}
  };
  for (let i = 0; i < n; i++) r.players.set('p' + i, match.makePlayer('p' + i, 'P' + i, '#ffffff', bot));
  return r;
}
// Start a match with players parked at known open spots and no random power-ups.
function arena(n) {
  const r = room(n);
  match.start(r);
  r.g.nextPower = Infinity;
  [...r.players.values()].forEach((p, i) => Object.assign(p, { x: 1000 + i * 40, y: 1000 }));
  return r;
}
const run = (r, seconds) => { for (let i = 0; i < seconds * CFG.TICK_RATE && r.state === 'playing'; i++) match.tick(r, DT); };
const last = (r, ev) => r.sent.filter(m => m.ev === ev).at(-1);

test('dash moves further than walking and respects its cooldown', () => {
  const r = arena(2), p = r.players.get('p0');
  p.inp = { dx: -1, dy: 0, a: 0, s: false };
  const x = p.x;
  assert.ok(match.dash(r, p));
  assert.ok(!match.dash(r, p), 'second dash is on cooldown');
  run(r, CFG.DASH_TIME);
  assert.ok(x - p.x > CFG.MOVE_SPEED * CFG.DASH_TIME * 2);
});

test('dash cannot pass through a wall', () => {
  const w = M.obstacles.find(o => o.h === 20);
  assert.ok(w);
  const r = arena(2), p = r.players.get('p0');
  Object.assign(p, { x: w.x + w.w / 2, y: w.y - M.PR - 2 });
  p.inp = { dx: 0, dy: 1, a: 0, s: false };
  match.dash(r, p);
  run(r, .3);
  assert.ok(p.y < w.y, `stayed above the wall (y=${p.y}, wall=${w.y})`);
});

test('shield absorbs arrow damage before health', () => {
  const r = arena(3), p = r.players.get('p1');
  match.applyPowerup(r.g, p, 'shield');
  match.damage(r, p, 40, 'p0');
  assert.strictEqual(p.shield, 0);
  assert.strictEqual(p.hp, 90);
  assert.strictEqual(r.players.get('p0').dealt, 40);
});

test('triple shot fires three arrows, and ricochet arrows bounce', () => {
  const r = arena(2), p = r.players.get('p0');
  match.applyPowerup(r.g, p, 'multi');
  match.applyPowerup(r.g, p, 'ricochet');
  p.inp = { dx: 0, dy: 0, a: Math.PI, s: true };
  match.tick(r, DT);
  assert.strictEqual(r.g.arrows.length, 3);
  p.inp.s = false;
  let bounced = false;
  for (let i = 0; i < 40 && r.g.arrows.length; i++) { match.tick(r, DT); bounced ||= r.g.arrows.some(a => a.bounces < CFG.RICOCHET_BOUNCES); }
  assert.ok(bounced);
});

test('timed power-ups expire', () => {
  const r = arena(2), p = r.players.get('p0');
  match.applyPowerup(r.g, p, 'multi');
  run(r, CFG.MULTI_TIME / 1000 + .2);
  p.inp = { dx: 0, dy: 0, a: Math.PI, s: true }; // shoot away from the other player
  match.tick(r, DT);
  assert.strictEqual(r.g.arrows.length, 1);
});

test('the storm shrinks to nothing through nested circles', () => {
  const z = match.newZone();
  let prev = z.r;
  for (let i = 0; i < 400 * CFG.TICK_RATE && z.mode !== 'done'; i++) {
    match.updateZone(z, DT);
    assert.ok(z.r <= prev + 1e-6);
    assert.ok(Math.hypot(z.to.x - z.from.x, z.to.y - z.from.y) <= Math.max(0, z.from.r - z.to.r) + 1e-6);
    prev = z.r;
  }
  assert.strictEqual(z.mode, 'done');
  assert.strictEqual(z.r, 0);
});

test('idle players are finished off by the storm with exactly one winner', () => {
  const r = arena(3);
  run(r, 300);
  const over = last(r, 'gameOver').data;
  assert.deepStrictEqual(over.results.map(x => x.place), [1, 2, 3]);
  assert.strictEqual(over.results[0].id, over.winnerId);
  assert.strictEqual(r.state, 'lobby');
});

test('kills and leavers get placements and kill feed entries', () => {
  const r = arena(3);
  match.damage(r, r.players.get('p1'), 100, 'p0');
  assert.deepStrictEqual([last(r, 'feed').data.place, last(r, 'feed').data.alive], [3, 2]);
  match.leave(r, r.players.get('p2'));
  r.players.delete('p2');
  match.finish(r);
  assert.strictEqual(last(r, 'feed').data.cause, 'left');
  const res = last(r, 'gameOver').data.results;
  assert.deepStrictEqual(res.map(x => [x.id, x.place, x.kills]), [['p0', 1, 1], ['p2', 2, 0], ['p1', 3, 0]]);
});

test('living players do not receive ghosts or hidden players', () => {
  const r = arena(3);
  match.damage(r, r.players.get('p2'), 100, 'p0');
  const bush = M.bushes[0];
  Object.assign(r.players.get('p1'), { x: bush.x, y: bush.y });
  match.tick(r, DT);
  const seen = id => r.sent.filter(m => m.ev === 'state' && m.to === id).at(-1).data.p.map(p => p.id).sort();
  assert.deepStrictEqual(seen('p0'), ['p0']);
  assert.deepStrictEqual(seen('p2'), ['p0', 'p1', 'p2']);
});

test('ghost chat is private to ghosts during a match and open afterwards', () => {
  const r = arena(3);
  match.damage(r, r.players.get('p2'), 100, 'p0');
  const readers = (from, now) => {
    r.sent = [];
    chat.handle(r, r.players.get(from), 'hi', now);
    return r.sent.filter(m => m.ev === 'chat').map(m => m.to).sort();
  };
  assert.deepStrictEqual(readers('p2', 1000), ['p2']);
  assert.deepStrictEqual(readers('p0', 1000), ['p0', 'p1', 'p2']);
  r.state = 'lobby';
  assert.deepStrictEqual(readers('p2', 2000), ['p0', 'p1', 'p2']);
});

test('chat is cleaned, length limited and rate limited', () => {
  assert.strictEqual(chat.clean('  a\nb‮c  '), 'a b c');
  assert.strictEqual(chat.clean('x'.repeat(500)).length, chat.MAX_LEN);
  assert.strictEqual(chat.clean({}), '');
  const r = room(2), p = r.players.get('p0');
  const results = Array.from({ length: 7 }, () => chat.handle(r, p, 'spam', 1000));
  assert.strictEqual(results.filter(Boolean).length, 5);
});

test('bot-only matches finish, and bots never end up inside walls', () => {
  for (let m = 0; m < 20; m++) {
    const r = room(5, ['easy', 'normal', 'hard'][m % 3]);
    match.start(r);
    for (let i = 0; i < 300 * CFG.TICK_RATE && r.state === 'playing'; i++) {
      match.tick(r, DT);
      for (const p of r.players.values()) if (p.alive) assert.ok(M.insideDist(p) > M.PR - 1 && !M.inSolid(p.x, p.y));
    }
    assert.ok(last(r, 'gameOver'), 'match ended');
  }
});
