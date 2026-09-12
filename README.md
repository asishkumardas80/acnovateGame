# DevRush Arena

A live, multiplayer team-building game for tech events. Everyone joins on their
own phone/laptop with a **name + avatar**; the host builds **random balanced
teams**, and everyone battles through **12 mini-games** together. No database,
no build step — just Node + Express and a `data.json` key-value store.

How it flows:
1. Each person opens the link, picks a **name + emoji avatar**, and lands in a
   shared **lobby** (everyone sees everyone).
2. The **host** clicks **Build Teams** → random, balanced teams of ~6 (with fun
   names/colors). **Reshuffle** to re-roll; late joiners auto-fill the smallest team.
3. Host clicks **Start Game**. Each player now sees their team and plays every
   mini-game on their own device.
4. A team's round score is the **average of its members' points**. All scoring is
   **automatic** (time, completion, correctness). Refreshing the page keeps you in;
   leaving and rejoining puts you back on your team.
5. Each team has a **private team chat** on the player screen so teammates can
   coordinate during the game.
6. Before each round starts, players see a **how-to-play + points** card on the
   "get ready" screen, and the **host** sees the same card ("Brief the players")
   so they can explain the game (edit the `GAME_HELP` map in `public/index.html`).

## Quick start

```bash
npm install
npm start
```

Open **http://localhost:3000**.

- **Players** click *Join the Arena*, enter a name + pick an avatar/color.
- The **Host** clicks *Host Console* and enters the passcode (default `devrush`,
  set at the top of `public/index.html` as `HOST_CODE`), then builds teams and
  starts the game.

To let teams join over your office Wi-Fi, share your machine's LAN address
(`http://<your-ip>:3000`) — the server prints a hint on startup.

## Letting remote teams join over the internet

Use a **Cloudflare Quick Tunnel** — no account, no deploy, no code changes. It
publishes your locally-running server at a temporary public HTTPS URL.

1. Install once (already done on this machine): `winget install Cloudflare.cloudflared`
2. Start the game and the tunnel together by double-clicking **`start-devrush.bat`**,
   or run manually in two terminals:
   ```bash
   npm start
   cloudflared tunnel --url http://localhost:3000
   ```
3. The tunnel window prints a line like `https://<random>.trycloudflare.com`.
   Share **that** URL with teams; open it yourself for the Host Console.

Notes:
- The URL is **new every launch** and only lives while `cloudflared` + the server
  run, so start them shortly before the event and keep both windows open.
- Because the game is now public, **change `HOST_CODE`** in `public/index.html`
  from the default so outsiders can't open the host console.
- Want an always-on link instead? A hosted deploy (Render/Railway/Fly.io) works,
  but note `data.json` and `public/uploads/` sit on the local filesystem — on
  hosts with ephemeral disks they reset on redeploy, so back them up or use a
  persistent volume.

## The 12 games

| # | Game | What teams do | Scoring |
|---|------|---------------|---------|
| 1 | Copy the Paragraph | Retype the given paragraph (3 min, no paste) | Auto: % of words matched |
| 2 | Maze Runner | Fog-of-war maze: collect all coins, reach exit, clear levels | Auto: coins + levels cleared |
| 3 | Code Sprint | Write `sumEven(arr)` | Auto: test cases passed |
| 4 | Guess the Output | Pick what code prints | Auto: correct + speed |
| 5 | Word Scramble | Unscramble 10 terms in 60s (Skip allowed) | Auto: 10 pts per word |
| 6 | Code Breakers | Each teammate solves a riddle for one digit; team combines to unlock the code | Team: unlock + speed bonus |
| 7 | Team Relay Quiz | Team discusses; anyone locks the shared answer | Team: correct answers (shared) |
| 8 | Memory Matrix | Repeat a growing sequence | Auto: level reached |
| 9 | Reaction Rush | Tap on green, ×3 | Auto: reaction time |
| 10 | Cipher Crack | Decode a Caesar cipher | Auto: correct + speed |
| 12 | Bug Hunt | Find the buggy line | Auto: correct + speed |
| 13 | Logo Guess | Team game: one logo every 30s; anyone spells the brand with letter tiles (2 hints/player) | Team: logos solved (shared) |

Every round is auto-scored: each player's result is submitted the moment they
finish (or when the timer hits zero), and a team's round score is the **average**
of its members' points. The host can still **override** a team's round score with
the per-team input on the console (`Set`, or `Auto` to revert to the average).

## How the host runs a round

1. Pick a round (the numbered buttons) — players see a "get ready" screen with
   their teammates.
2. **Start Round** — the synced countdown begins on every screen; everyone plays.
3. Watch each team's members submit live in the *Live* panel (with the running
   team average).
4. **End & Reveal** — players see the answer and their points.
5. **Next ▶** to move on. The leaderboard updates everywhere in real time.
6. **Back to Lobby** returns to team-building (teams are kept; you can reshuffle).

Host reset options:
- **🔁 Restart Round** (in-game) — clears just the *current* round's scores and
  returns it to the ready state, so teams can replay that one game. Other rounds
  keep their scores.
- **🔁 Restart game** (in the lobby) — clears *all* scores but keeps the same
  players and teams, ready to play the whole thing again from round 1.
- **Reset** — wipes everyone, teams and scores for a fresh event.

### Logo Guess setup

Logo Guess is a team round: put one PNG per logo in `public/logos/` (exact file
names are listed in `public/logos/README.txt`), and set the matching `answer`/`hint`
in the `logos:` array of round `r13` in `public/index.html`. During play, one logo
shows for 30 seconds and auto-advances; anyone on a team spells the brand with the
on-screen letter tiles to lock it in (2 hints per player). The team scores one
point per logo it gets right.

## Architecture

- `server.js` — Express. Serves `public/` and a KV API:
  - `GET /api/all` — the whole store (host + teams poll this every ~2s)
  - `GET /api/storage/:key` / `POST /api/storage/:key` — read/write one key
  - `GET /api/time` — server clock, used to sync the countdown across devices
  - `POST /api/upload` — save a host-uploaded image (JSON `{filename, dataUrl}`)
    to `public/uploads/` and return its URL (used by Logo Guess)
  - `POST /api/clearScores` — clear ALL scores/submissions (host "Restart game");
    keeps players, teams and logos
  - `POST /api/reset` — wipe everything (host "Reset")
- `public/index.html` — the entire single-page app (landing / join / player /
  host), all 12 games, sound + confetti. No external dependencies or CDNs, so it
  works fully offline on a LAN.
- `data.json` — the persisted store. Deleting it resets the game.

### Keys used in the store

- `game` — `{ stage, roundIndex, phase, tStart, duration }` (host-controlled;
  `stage` is `lobby` or `game`)
- `player:<pid>` — one person: `{ pid, name, emoji, color, ts }`
- `teams` — the built teams: `[{ id, name, color, pids:[…] }]`
- `panswer:<roundIndex>:<pid>` — a person's submission summary (for the host)
- `pscore:<roundIndex>:<pid>` — a person's points that round
- `tscore:<roundIndex>:<teamId>` — host override for a team's round score
- `config:logoset` — the Logo Guess logos: `[{ url, answer }, …]`
- `chat:<teamId>:<msgId>` — one team-chat message `{ pid, name, emoji, color, text, ts }`

A team's round score is the average of its members' `pscore` values (unless a
`tscore` override is set); its total is the sum across rounds. Because every
person writes only their own `player:`/`pscore:` keys, simultaneous joins and
submissions never overwrite each other. Host-uploaded images live in
`public/uploads/` (created automatically).

A team's total is the sum of its `score:*` values. Because every team writes to
its own key, simultaneous submissions never overwrite each other.

## Customizing

- **Team size:** change `TEAM_TARGET` (default 6) at the top of `public/index.html`.
- **Team names/colors:** edit the `TEAM_POOL` array.
- **Avatars/colors:** edit the `AVATARS` and `COLORS` arrays.
- **Rounds:** edit the `ROUNDS` array — reorder, change prompts/answers,
  durations, add or remove games. Each round's `type` picks the game engine.
- **Host passcode:** change `HOST_CODE`.
