# Pentagon Arena

Browser multiplayer bow arena battle royale. Node.js + Express + Socket.io. No database,
no Firebase. Accounts live in the browser's LocalStorage.

## Run

You need [Node.js](https://nodejs.org) 18 or newer. In this folder:

```bash
npm install
npm start
```

Open http://localhost:3000. To play alone, create a room, press **Add AI bot**, then
**Start game**. For more humans, open more browser windows (use a different profile or an
incognito window so each has its own account). On a LAN, others open
`http://<your-ip>:3000`.

`npm test` runs the game-rule tests.

## Controls

| Action | Input |
| --- | --- |
| Move | WASD or arrow keys |
| Aim / shoot | Mouse / hold left click |
| Dash | Space or right click |
| Chat | Enter to type, Enter to send, Esc to cancel |
| Sound on/off | M or the button at the top right |

## Features

**AI bots.** The host adds Easy, Normal or Hard bots in the room screen. Bots count toward
the player limit (5 at most). If a room is full and a person joins, one bot makes way.
Bots find paths around walls, avoid the storm, collect power-ups, dodge arrows and cannot
see into bushes.

**Storm.** The safe circle shrinks in five phases. The dashed white circle shows where it
will end up. Damage outside rises from 2 to 15 HP per second and ignores shields. The last
circle closes completely, so every match ends.

**Dash.** A short burst (about 150 px) in your movement direction, or your aim direction
if standing still. 4 second cooldown. It does not pass through walls.

**Power-ups.** Five appear inside the zone every 25 seconds (at most 14 on the map).

| Icon | Name | Effect |
| --- | --- | --- |
| x2 | Power | Doubles arrow damage (permanent, stacks) |
| A | Agility | Attacks 1.5x faster (permanent, stacks) |
| + | Food | +10 HP |
| S | Shield | +30 shield against arrows (60 at most) |
| » | Speed | Move 40% faster for 8 s |
| 3 | Triple shot | Three arrows per shot for 10 s |
| R | Ricochet | Arrows bounce twice for 10 s |

**Minimap.** Shows walls, bushes, power-ups, the storm and you. While alive, enemies show
only if they are close or have just fired, and never while hidden from you. Ghosts see
everyone.

**Kill feed and placements.** Every elimination shows who did it, the placement and how
many remain. Leaving mid-match counts as elimination.

**Results screen.** Placements, kills, damage and survival time, with **Back to room** and
(for the host) **Play again**.

**Spectating and chat rules.** Eliminated players become ghosts: they fly through walls,
see the whole map and cannot attack. The server enforces who reads what:

| When | Sender | Who reads it |
| --- | --- | --- |
| During a match | Living player | Everyone |
| During a match | Ghost | Ghosts only |
| Room lobby and after a match | Anyone | Everyone |

Messages are limited to 120 characters and 5 per 5 seconds.

**Sound effects.** Generated in the browser with the Web Audio API, so there are no audio
files. Browsers start audio only after your first click or key press.

## Files

- `server/server.js`: rooms, bot slots, socket events
- `server/match.js`: match rules (movement, dash, arrows, power-ups, storm, placements)
- `server/bots.js`: bot decisions and pathfinding
- `server/chat.js`: chat and ghost rules
- `server/map.js`: map generation and collision
- `server/config.js`: **balance settings** (storm timing, cooldowns, power-ups)
- `client/index.html`, `client/style.css`: screens and layout
- `client/game.js`: input, rendering, HUD, minimap, chat, results
- `client/sound.js`: sound effects
- `test/game.test.js`: game-rule tests

If you change shield or heal amounts in `config.js`, also update the HUD shield bar and
pickup messages in `client/game.js`.

## Notes

- There is no leaderboard and the server stores nothing on disk. Each player's kills and
  wins (including those against bots) are kept in their own browser's LocalStorage.
- "My Rooms" is stored in the host's LocalStorage (key `arena_rooms`). Bots are not saved.
- Room passwords are stored and compared in plain text.
- If the host leaves, the room closes.
- There is no touch control scheme; play with a keyboard and mouse.
