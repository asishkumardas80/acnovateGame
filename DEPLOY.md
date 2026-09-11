# Deploying DevRush Arena to the cloud

The app is a single Node/Express server (`server.js`) serving `public/`. It reads
`process.env.PORT`, so it runs on any Node host. It's already committed to git and
ready to push.

## Before you deploy
- **Add your logo images** to `public/logos/` (see `public/logos/README.txt`) and
  commit them — on the cloud there's no runtime upload storage, so logos must be in
  the repo.
- **State is in-memory + `data.json`** (ephemeral on cloud): a redeploy/restart
  clears scores/teams. That's fine for an event — just don't redeploy mid-game.
- **Change the host passcode** (`HOST_CODE` in `public/index.html`) before going public.

## Option A — Render (free, easiest) ⭐
1. Push this folder to a new GitHub repo (see "Push to GitHub" below).
2. Go to https://render.com → sign up → **New +** → **Blueprint** → pick your repo.
   (It reads `render.yaml` and configures everything.)
3. Click **Apply**. In ~1–2 min you get a URL like `https://devrush-arena.onrender.com`.
4. Share that URL with players; open it yourself for the Host Console.
- Note: the **free** plan sleeps after ~15 min idle (first visit then takes ~30–60s
  to wake). Open the URL a minute before the event, or use Option B/C for no sleep.

## Option B — Railway (no sleep, very simple)
1. Push to GitHub.
2. https://railway.app → **New Project** → **Deploy from GitHub repo** → pick it.
3. Railway auto-detects Node, runs `npm install` + `npm start`, gives a public URL.

## Option C — Fly.io (no sleep, uses the Dockerfile)
1. Install flyctl, then `fly launch` (accept the Dockerfile) → `fly deploy`.

## Push to GitHub
If you have the GitHub CLI (`gh`):
```
gh auth login
gh repo create devrush-arena --private --source . --push
```
Or manually: create an empty repo on github.com, then:
```
git remote add origin https://github.com/<you>/devrush-arena.git
git branch -M main
git push -u origin main
```

## Performance (handles ~60 players)
- Responses are gzip-compressed and clients poll with a version tag, so an
  unchanged game returns a tiny `304 Not Modified` instead of the whole state.
- Any small instance (Render free / Railway / Fly shared-cpu-1x) handles ~60
  players polling every 2s comfortably.
