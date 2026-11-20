# CLAUDE.md

This repo holds the mini-games played inside the Pipal app. It is separate from the Pipal app repo (`pipal`) on purpose,
but it deploys to the **same** Pipal infrastructure: Cloudflare Pages project `pipal-games` and Pipal's Supabase `games` table.
Nothing about where games are hosted or registered changed by splitting the code.

## Read first
- `docs/GAME_PLATFORM.md`: the contract (window.pipal bridge, economy rules, perf budgets, Samsung A16 reference device). Authoritative.
- `docs/GAME_BUNDLE_DEPLOYMENT.md`: hosting and the Supabase `games` row.

## Layout
- `games/<id>/index.html` (+ `manifest.json`, assets, thumbnail). `<id>` is permanent. Display name lives only in `games.title` in Supabase.
- `scripts/`: manifest generator, per-game build scripts (flip, delivery data bakes), deploy.
- Some games have `src/` and are built into a single `index.html` (flip: `npm run build:flip`; delivery: `scripts/delivery-data/build.mjs`).

## Build and deploy
```bash
npm install
npm run deploy      # creates missing manifest.json files (existing ones are kept; `node scripts/games-manifest.js --force` regenerates), then wrangler pages deploy games --project-name=pipal-games
```
Requires Cloudflare auth for the Pipal account (`npx wrangler login`, or CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID).
Live URL: `https://pipal-games.pages.dev/<id>/`.

After changing a game's files, bump the cache-busting `?v=` in Supabase: `UPDATE games SET bundle_url='https://pipal-games.pages.dev/<id>/?v=<YYYYMMDD-N>' WHERE id='<id>'`.
Use the Pipal project's Supabase (URL in the pipal repo `.env`, `EXPO_PUBLIC_SUPABASE_URL`). Adding a new game also needs an INSERT (see deployment doc).

## Rules
- Single static bundle, works offline, feature-detect `window.pipal` so it runs in a plain browser.
- Never trust the client for gems or money; use `pipal.run.*` / `pipal.gems.*`.
- Do not start Chrome/browser checks for games; verify with `node --check` and deploy, the user tests on the phone.
- Never commit secrets or tokens. No em dashes in player-facing copy. Never write "beef" (say Buff).
- Deploying and editing the live `games` table affect production: only do them when asked.
