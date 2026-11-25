# Pentagon Arena (MVP)

Browser multiplayer bow arena. Node.js + Express + Socket.io. No database, no Firebase.
Accounts live in the browser's LocalStorage.

## Run

```bash
npm install
npm start
```

Open http://localhost:3000 in two or more browser windows (use different profiles or an
incognito window so each has its own LocalStorage account). On a LAN, other players open
`http://<your-ip>:3000`.

## Controls

WASD / arrow keys move, mouse aims, hold left click to shoot. Dead players become ghosts
(free movement, whole-map view, no attacks).

## Files

- `client/index.html`, `client/style.css`, `client/game.js`: UI, canvas rendering, input
- `server/server.js`: rooms, authoritative game loop (30 Hz), powerups
- `package.json`

## Notes

- There is no leaderboard and the server stores nothing on disk. Each player's kills and
  wins are kept in their own browser's LocalStorage account.
- "My Rooms" is stored in the host's LocalStorage (key `arena_rooms`).
- Room passwords are stored and compared in plain text.
