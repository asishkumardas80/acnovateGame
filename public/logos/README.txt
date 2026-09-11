DevRush Arena — Logo Guess images (14 harder tech + brand logos)
================================================================

Place one image file per logo in THIS folder (public/logos/), using these
EXACT file names. PNG with a transparent (or white) background works best,
roughly square, ~300px. The game shows them on a white card. These are
ICON-style logos (the name is NOT written in the logo) so they're a real
challenge — search "<brand> logo png transparent" and grab the icon/symbol.

  github.png       ->  GitHub      (Octocat)
  docker.png       ->  Docker      (whale)
  figma.png        ->  Figma       (coloured shapes)
  slack.png        ->  Slack       (hashtag / pinwheel)
  firebase.png     ->  Firebase    (flame)
  mongodb.png      ->  MongoDB     (green leaf)
  kubernetes.png   ->  Kubernetes  (ship's helm / wheel)
  vercel.png       ->  Vercel      (black triangle)
  redis.png        ->  Redis       (red cube stack)
  discord.png      ->  Discord     (game-controller face)
  nvidia.png       ->  NVIDIA      (green eye)
  airbnb.png       ->  Airbnb      (the "bélo" loop)
  reddit.png       ->  Reddit      (Snoo alien)
  notion.png       ->  Notion      (the N)

Notes
-----
- File names must match exactly (lowercase, .png). If your file is .svg/.jpg,
  convert to .png or change the `img:` path in the r13 "logos" list in
  public/index.html.
- Each round randomly shows `count` (currently 7) of these 14.
- To add/remove/edit logos: edit the `logos:[ ... ]` array of round r13 in
  public/index.html — each entry is { img:'logos/<file>.png', answer:'BRAND', hint:'...' }.
- Missing files show a "Logo image not found" placeholder (the game still runs).
- The earlier easy set (google/apple/netflix/...) is no longer used — you can
  delete those files if you like.
