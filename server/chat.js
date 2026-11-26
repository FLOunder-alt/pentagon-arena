/* Chat with ghost/spectator rules, enforced on the server.
 *
 *  - During a match, living players' messages reach everyone (ghosts can read them).
 *  - During a match, eliminated players (ghosts) can only be read by other ghosts.
 *  - In the room lobby and after a match ends, everyone can talk to everyone.
 */
const MAX_LEN = 120, WINDOW = 5000, MAX_PER_WINDOW = 5;

// strip control characters, line separators and text-direction overrides
const clean = t => typeof t === 'string'
  ? t.replace(/[\p{Cc}\p{Zl}\p{Zp}\p{Bidi_Control}]/gu, ' ').trim().slice(0, MAX_LEN) : '';

function handle(r, sender, raw, now = Date.now()) {
  const text = clean(raw);
  if (!text) return false;
  sender.chatTimes = (sender.chatTimes || []).filter(t => now - t < WINDOW);
  if (sender.chatTimes.length >= MAX_PER_WINDOW) { r.net.to(sender.id, 'toast', 'Slow down: too many messages.'); return false; }
  sender.chatTimes.push(now);

  const playing = r.state === 'playing';
  const channel = !playing ? 'room' : sender.alive ? 'all' : 'ghost';
  const msg = { id: sender.id, name: sender.username, color: sender.color, text, channel };
  for (const p of r.players.values()) {
    if (p.bot || (channel === 'ghost' && p.alive)) continue;
    r.net.to(p.id, 'chat', msg);
  }
  return true;
}

module.exports = { handle, clean, MAX_LEN };
