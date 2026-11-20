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

## The native shell (what wraps every game)

Every game runs inside `GameWebViewModal` in the Pipal app (`components/GameWebViewModal.tsx`, `components/games/GameShellParts.tsx`,
`lib/game-capabilities.ts`, `lib/game-bridge.ts` in the `pipal` repo). The WebView fills the **entire screen, edge to edge, including under the
status bar and notch**. The shell then draws native chrome **on top of** the game. A game must leave room for it and must never draw its own copy of it.

### What the shell draws (do not duplicate, do not put interactive UI underneath)
All of it sits in one row at the top, `overlayTop` px from the top edge, 12 px in from the left and right:

```
+---------------------------------------------------------------+
| (status bar / notch)                                          |
|  [💎 1,234]          [centre clock pill*]       [action] [⚙]  |  <- HUD row, ~32 px tall (40 if chrome=chunky)
|                                                               |
|                       GAME CANVAS                             |
|                                                               |
|                (bottom: nothing native, full bleed)           |
+---------------------------------------------------------------+
```
- **Gem pill, top-left.** Dark translucent capsule, gold text, shows the server gem balance. Tapping it sends the game `{type:'openBuyGems'}`, so the game must show its own buy-gems overlay (or ignore it). Hidden when `capabilities.gemPill = false`; the game may then use that corner. Roughly 90 to 130 px wide.
- **Settings gear, top-right.** 32 px round button (glass) or 40x46 candy button (chunky). Opens the native menu: Resume, Sound (if `sound`), Rotate (if `rotate`), game items, **Exit Game**. **The game never draws an exit, close, pause-menu or gear button.** Use `pipal.exit()` only for in-game "quit" flows (end of run screens).
- **Header actions, left of the gear.** Up to 2 extra icon buttons declared in `capabilities.headerActions` (e.g. Momo King's Manage). They fire `{type: event}` at the game, same size and gap (8 px) as the gear.
- **Centre clock pill** (optional, 108 px wide, top-centre) when the legacy `stats` message carries a world clock. New games should not use it.
- **Loader.** Native full-screen loading overlay with the game's thumbnail and title until `onLoadEnd`, or until `pipal.ready()` when `signalsReady` (hard cap 8 s). Do not build your own splash that delays the first frame.
- **Feedback sheet** (once per game, after 20+ seconds of play, on exit) and **gem session summary** (when `exitSummary` and the game used the gem wallet). Both pause the game.

### Reserved zones (the rule for game UI)
- **Top band is reserved.** Keep all HUD, score, timers and tappable UI below `layout.top + 44` px. `overlayTop` is, by `capabilities.topInset`: `default` = safeAreaTop + 8, `tight` = max(12, safeAreaTop - 4), `minimal` = max(10, safeAreaTop). With `sendsLayout: true` the shell sends `{type:'layout', top, manage}` on load and whenever it changes; read it via `pipal.on('layout', e => ...)` and set a CSS variable. Without it, assume `top = 56` px and reserve about 100 px at the top.
- **Do not rely on `env(safe-area-inset-*)`.** It is unreliable in the Android WebView. Use the `layout` message and keep important things at least 12 px from left/right and 16 px from the bottom.
- **Left and right 12 px gutters and the full bottom edge belong to the game.** Put primary thumb controls at the bottom.
- Backgrounds and the 3D scene should still extend under the HUD (full bleed); only interactive and informational UI avoids the band.
- **Simulated landscape** (`rotate: true`): the shell rotates WebView and HUD together by 90 degrees and swaps the sizes, so the HUD keeps the same corners relative to the game. `overlayTop` becomes 12, left gutter = safeAreaTop + 12, right = safeAreaBottom + 12. Handle `resize`; the game sees a landscape viewport. Never lock orientation yourself.
- **Hit targets:** minimum 44x44 px for anything you draw. The shell's own buttons have enlarged hit slop, so do not place your buttons within about 12 px of the gear or gem pill.

### Lifecycle the game must implement
- `pipal.on('pause')` / `pipal.on('resume')` (also `pipal.paused`). Pause is sent when the menu is open, the feedback sheet or summary shows, or the app is backgrounded. Stop simulation, audio and timers, and do not spend `requestAnimationFrame` while paused. On resume clamp the first frame's delta time (the first frame after resume is late). With `freezeOnPause` the shell holds rAF for you, but you still clamp dt.
- `pipal.on('settings', e => e.sound)` when `sound` is on: honour the shell's Sound toggle.
- `pipal.on('resetGame' | 'openManage' | ...)` for any `menuItems` / `headerActions` you declared.
- Call `pipal.ready()` after the first real frame if `signalsReady` is set.
- State goes in `localStorage` (WebView DOM storage is on), private to the game, never money. The render process can be killed on low-end Android and the shell reloads the page, so restore from `localStorage` on load.

### WebView environment (what you can and cannot do)
- Loaded from `file://` after the offline install (or `https://pipal-games.pages.dev/<id>/` as fallback). Every file the game needs must be listed in `manifest.json` or it will be missing offline. Use relative paths only.
- JavaScript, DOM storage, inline media playback and autoplay-without-gesture are on. Scrolling, bounce and overscroll are off, text zoom is fixed at 100 percent. Pinch zoom is not available. No multi-window or `window.open`.
- The top frame cannot navigate away; non-file navigations are blocked except the game's own host. No runtime network calls except through `window.pipal`. CDN imports are only allowed from unpkg, jsdelivr, cdnjs (the app rewrites them for offline).
- `window.devicePixelRatio` is already capped by `maxPixelRatio` (default 2), so `renderer.setPixelRatio(devicePixelRatio)` is safe.
- Reference device: Samsung A16 over USB (not an emulator). Target steady 30 fps. Budgets in `docs/GAME_PLATFORM.md` section 6.

### Declaring shell behaviour (capabilities, not code)
A game's chrome is configured by the `games.capabilities` jsonb column on its row, never by adding `game.id` branches to the shell. Keys:
`gemPill, exitSummary, rotate, pausable, sound, sendsLayout, manageLayout, topInset (default|tight|minimal), chrome (glass|chunky), signalsReady, freezeOnPause, maxPixelRatio (1 to 4), headerActions (max 2), menuItems (max 4)`. Unknown keys and bad types are ignored. Defaults: gemPill, exitSummary, pausable true; everything else off; topInset default; chrome glass. Full shape and examples are in `docs/GAME_PLATFORM.md` section 5.

New games should normally set: `signalsReady: true`, `sendsLayout: true`, `gemPill` as appropriate (false if the game has no gem economy), `freezeOnPause: true` if dt is clamped. Changing the shell itself (new chrome, new capability keys) is a change in the `pipal` repo plus an app build, so ask the user before assuming a new capability exists.


### Per-game notes
- **bluff-club:** inside the shell it relies on the native settings menu for Sound and How to play, so its `games.capabilities` must include `"sound": true, "menuItems": [{"id":"help","label":"How to play","icon":"help-circle-outline","event":"howToPlay"}]` (plus `signalsReady`/`gemPill` as wanted). The game hides its own sound and help buttons whenever `window.pipal` exists, and shows them in a plain browser (no gear there). Reactions open from tapping the player's own avatar (bottom left), with a light blur behind.


## Online mode (Bluff, quick match with gem entry fees)
**Building online for any game: read `docs/ONLINE_GAMES.md` first (agent playbook: architecture, invariants, procedure, go-live).** This section is the Bluff-specific state.
Contract: `online/PROTOCOL.md` (rules, money, endpoints, every message). Server: `online/` (Cloudflare Worker + two Durable Objects, plain JS). Client: the ONLINE MODE block in `games/bluff-club/index.html`. Database: `supabase/migrations/20261121_online_escrow.sql` in the pipal repo (escrow/settle/refund RPCs, service_role only, kill switch `online_enabled`, default 0 = OFF).
- Tests: `cd online && npm test` (engine + 300-game sim), `npm run e2e` (local wrangler, free tier only). Local play: `npm run dev`, then open the game with `?dev=alice&ws=ws://localhost:8787` (DEV_AUTH: no money moves, fee 0).
- Money: fee tiers 0/10/50. Winner gets pot minus 10% (burned). A bot or forfeited seat winning refunds each human 90% of their fee. A cron (every 10 min) refunds matches stuck in escrow for 90+ minutes.
- Auth: the game asks the Pipal app for the user's token via `pipal.user.token()` (needs the next app build; the Play online button hides itself until it exists).
- **Never set `DEV_AUTH` in production.**

### Go-live checklist (status 2026-11-20: steps 1, 2 and the game deploy are DONE; kill switch still 0; app build with `pipal.user.token` not started)
1. Pipal repo: apply `20261121_online_escrow.sql` (adds tables/functions, widens the ledger kind check; kill switch stays 0).
2. `cd online && npx wrangler secret put SUPABASE_URL | SUPABASE_PUBLISHABLE_KEY | SUPABASE_SECRET_KEY | ROOM_SECRET`, then `npx wrangler deploy`, then add a route/custom domain and put it in `ONLINE_URL` in `games/bluff-club/index.html` (done: wss://pipal-bluff-online.koshishtiwari.workers.dev).
3. Ship an app build with `pipal.user.token` (lib/game-bridge.ts + GameWebViewModal.tsx), then deploy the game bundle and bump its `?v=`.
4. Test with the free tier first, then `UPDATE game_economy_limits SET value = 1 WHERE key = 'online_enabled'` to allow paid matches. Flip back to 0 to stop new paid matches instantly (settle/refund keep working).
Known gaps: room state lives in memory (a Durable Object restart ends that match; the cron refunds the escrow later), settle retries 4x then only logs, paid-tier paths are untested against a live Supabase, the GIF reaction is not relayed online (emoji only).

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
