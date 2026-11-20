# Pipal Game Platform (agent-facing spec)

Audience: coding agents building or modifying Pipal games. Terse on purpose. Status markers:
- **[LIVE]** exists in the repo today.
- **[SPEC]** agreed direction, not built. Do not assume it exists; check before using.

## 1. What a game is

A game is a static web bundle: `games/<id>/index.html` plus optional assets listed in `games/<id>/manifest.json`.
No server code. No build step required (single HTML with inline JS is fine; CDN imports only from unpkg, jsdelivr, cdnjs, which `lib/offline-games.ts` rewrites for offline use).
The app downloads the bundle and loads it from `file://` in a WebView (`components/GameWebViewModal.tsx`). It is registered in the `games` table (`bundle_url`, `thumbnail_url`, `category`, `coins_reward_max`, `active`, `sort_order`). **[LIVE]**

A game must:
1. Work fully offline after first install.
2. Run at a steady 30fps on a Samsung A16 (the reference device). Budgets in section 7.
3. Never assume it owns the screen chrome. The native shell draws the header, settings menu, exit, loading screen and feedback sheet. Do not draw your own exit or gem pill.
4. Never trust itself for money. All value (gems, mana) is decided by the server (section 4).

### Names: one source of truth
- `games.id` is a permanent internal key (folder name, offline cache key, capability lookup). It never changes and is never shown to players.
- `games.title` is the only place a display name exists. Rename a game with `UPDATE games SET title='...' WHERE id='...'`. Catalog clients pick it up within about 5 minutes. The loader, Games hub, feedback sheet and the in-game `pipal.game.title` all read it.
- Never hardcode a game's name in TS, HTML, docs or copy. In a bundle use `pipal.game.title` (fallback to a neutral word like "Momo" when running in a plain browser). Diegetic in-world names (the shop sign) are not the game title and may stay.

## 2. Ownership split: native shell vs game

| Concern | Owner |
|---|---|
| Loading screen, exit, settings menu, rotate, pause on background, haptics, feedback sheet | Native shell (`GameWebViewModal`) |
| Gem balance pill, buy-gems flow, session summary | Native shell |
| Gameplay, game-local UI, game-local state (cash, XP, inventory) | Game |
| Gem balance of record, mana, leaderboards, rewards | Server (Supabase RPC) |

Game-local state belongs in `localStorage` (WebView `domStorageEnabled`) and is private to the game. It is never money.

## 3. Bridge: `window.pipal` **[LIVE, 2026-11-18]**

The shell injects `window.pipal` before your scripts (`lib/game-bridge.ts`). Prefer it over raw `postMessage`. Games must feature-detect: `if (window.pipal) {...}`, so a bundle still runs in a plain browser for development.

```
pipal.ready()                      // first frame drawn; hides the loader (only if capabilities.signalsReady)
pipal.haptic(style)                // light | medium | heavy | success | warning | selection
pipal.exit()                       // runs the normal exit flow (feedback sheet, summary)
pipal.gems.balance()   -> Promise<{gems, mana}>           // server values
pipal.gems.buy(mana)   -> Promise<{gems, gemBalance, manaBalance}>  // atomic buy_gems RPC; rejects with error string
pipal.run.start()      -> Promise<{runId}>       // server records the start time
pipal.run.end({runId, score, combo}) -> Promise<{gems, requested, limitedBy, gemBalance}>
                                   // server measures duration, validates, grants gems within budgets.
                                   // Without runId it is the legacy gameOver (Mana claim via onGameOver).
pipal.gems.spend({amount, sku, ref}) -> Promise<{gemBalance, duplicate}>  // idempotent on ref; rejects 'insufficient_gems'
pipal.on(name, fn) / pipal.off(name, fn)   // names: pause, resume, settings, layout, openBuyGems, openManage, resetGame, or any menu/header event
pipal.paused                       // boolean
pipal.platform                     // { os, maxPixelRatio }
pipal.game                         // { id, title }, title comes from games.title
```

Automatic, no game changes: `window.devicePixelRatio` is capped to `capabilities.maxPixelRatio` (default 2). With `freezeOnPause`, `requestAnimationFrame` callbacks are held while paused and flushed on resume (clamp your frame delta, the first frame after resume is late).

Not built yet: `pipal.user`, `pipal.leaderboard`, `pipal.room`.

### Legacy raw messages (still supported, do not use in new games)
Game -> app: `stats`, `gameOver`, `getManaBalance`, `buyGems`, `haptic`.
App -> game: `manaBalance`, `gemsGranted`, `gemsDenied`, `openBuyGems`, `layout`, `pause`, `resume`, `settings`, `openManage`, `resetGame`.
The legacy gem-wallet flow has the game report its bank via `stats.coins` and the shell saves it on exit through `set_gem_balance`, which the server now caps (section 4).

## 4. Economy rules (the important part)

### Currencies **[SPEC, decided direction]**
- **Gems are the only currency that crosses the game boundary.** One platform wallet (`game_saves.balance`).
- **Mana** is the real-value currency (checkout discounts). Gems -> Mana is a one-way, rate-limited valve (10 gems = 1 mana, 24h lock, `request_gem_conversion` / `claim_gem_conversion`). **[LIVE]** Mana -> Gems is `buyGems` (1 mana = 10 gems). **[LIVE]**
- **A game may have its own local currency** (Ready Set Momo cash). It lives in the game's own save data, is never exchanged for gems, and is not on the server's books. Gems may be spent *into* a game for a local boost, and the server may grant gems *out* only through a faucet (below). There is no direct local-currency -> gem conversion, ever. This is the Roblox rule: per-game currencies are sealed.

### Faucets and sinks **[SPEC]**
Gems enter the system only via server-issued grants, never via client-reported balances.
- A faucet is a server RPC, e.g. `claim_game_reward(game_id, client_token, score, combo, duration_ms)` **[LIVE]**, that checks plausibility and idempotency (`client_token`).
- Every faucet draws from a budget: per user per day, per game per day, and a global daily gem-mint ceiling. When a budget is spent, grants return 0 with `error: "budget_exhausted"`. Games must handle that without breaking.
- Sinks must exist for every faucet: gem purchases of in-game items, entry fees, cosmetics, boosts, and the conversion valve itself.
- Gem -> Mana conversion must have a per-user and global daily cap, because mana has real checkout value.

### Hard rules for game authors
1. Never send a gem balance to the app as truth. The app does not accept `coins` as a balance to write (see known issue below).
2. Never mint gems from client-computed scores without a server faucet.
3. Randomized paid outcomes (blind boxes, loot) must use server-side RNG and must never pay out mana or anything with cash value. Closed loop only.
4. No cash-out of gems or mana to money, ever.

### Anti-mint controls **[LIVE in prod since 2026-11-19]**
Migrations `20261118_game_economy_hardening` and `20261119_game_gem_faucets`.
- Client-reported gem gains (`set_gem_balance`, legacy games) are capped per user per UTC day (`daily_gem_earn_cap`, 2000) and count against the global ceiling. Decreases are always allowed. `earn_gems` is not callable by clients.
- **Server-granted gems** for pipal-native games: `start_game_run` -> `end_game_run`. The server times the run, rejects scores above `games.max_score_per_sec`, ignores runs shorter than `min_run_ms`, and grants `floor(score * gem_per_score)` clipped by, in order: `gem_max_per_run`, `gem_user_daily_cap` (per user per game per day), `gem_daily_budget` (per game per day), and `game_economy_limits.global_daily_gem_mint` (all games). The response says which limit bit (`limited_by`: daily_user_cap, game_budget, global_budget, too_short, implausible_score, no_faucet).
- **Every faucet is OFF by default.** To enable a game: `UPDATE games SET gem_per_score=.., gem_max_per_run=.., gem_user_daily_cap=.., gem_daily_budget=.., max_score_per_sec=.. WHERE id='..'`. Pick `gem_daily_budget` from what you are willing to see convert: gems -> Mana is 10:1 and capped at 1000 gems per request.
- **Gems do not convert to Mana except through the Pipal Developer Fund** (migration `20261120`). `request_gem_conversion` requires an active row in `developer_fund_members`, `exchange_enabled = 1`, and stays under the member's monthly cap (`monthly_gem_cap`, default `exchange_monthly_member_gems` 5000) and the Fund's monthly total (`exchange_monthly_global_gems`). Rate is 10 gems = 1 Mana, 24h lock, max 1000 gems per request. Non-members get `not_in_developer_fund`; the app's TRADE tab shows members-only copy. Accept members in admin > Games > Developer Fund. Existing pending conversions can still be claimed.
- **Kill switches** (admin > Games): `faucets_enabled = 0` zeroes the global mint ceiling (stops server grants and client-reported gains); `exchange_enabled = 0` pauses the exchange.
- **Sinks**: `spend_game_gems` is idempotent on `ref` and counted as burn. Mana -> gems (`buy_gems`) is atomic.
- Audit: `game_gem_ledger` (every grant, spend, legacy gain), `game_faucet_daily` (minted/burned per game per day, `*` is global), RPC `get_game_economy(days)` for admins.
- Games must treat `gems: 0` with a `limitedBy` as normal, not an error. Show "come back tomorrow" style copy, never retry.

Tune live with `UPDATE game_economy_limits SET value=.. WHERE key=..` (no deploy).

Not built: Developer Fund application flow in the app (admins accept members by hand), payout beyond Mana, and a cleanup of pre-existing inflated balances. Admin > Games has Set balance (logged to the ledger with a reason) for that.

## 5. Capabilities (replaces `game.id ===` branches) **[LIVE]**

The shell reads `GameCapabilities` (`lib/game-capabilities.ts`). Resolution: defaults, then built-in table for legacy ids, then `games.capabilities` jsonb (column added by 20261118; sanitized, bad values ignored). Declare new games in the DB row, never add `game.id` checks to the shell.

```json
{ "gemPill": true, "exitSummary": true, "rotate": false, "pausable": true, "sound": false,
  "sendsLayout": false, "manageLayout": false, "topInset": "default|tight|minimal",
  "chrome": "glass|chunky", "signalsReady": false, "freezeOnPause": false, "maxPixelRatio": 2,
  "headerActions": [{"id":"manage","icon":"people","event":"openManage"}],
  "menuItems": [{"id":"reset","label":"Reset game","icon":"refresh-outline","tone":"warn","event":"resetGame",
                 "confirm":{"title":"Reset game?","body":"...","confirmLabel":"Reset"}}] }
```
Menu order is fixed: Resume (if pausable), Sound (if sound), Rotate (if rotate), game items, Exit. Game events arrive as `{type: event}` (`pipal.on(event, fn)`).

## 6. Performance budgets (Samsung A16 reference)

- Cap `renderer.setPixelRatio(Math.min(devicePixelRatio, perf.maxPixelRatio))`. Default cap 2.
- Pause the render loop on `pause` and `document.hidden`. Do not run `requestAnimationFrame` while paused.
- Draw calls under ~150, triangles under ~150k per frame, one shadow-casting light maximum.
- Textures: power-of-two, KTX2 or WebP, under 2048px. Dispose geometries, materials and textures on scene change.
- No network at runtime except through `window.pipal`. No `eval`. No external fonts.
- Bundle: under 5 MB total preferred. All assets listed in `manifest.json` so they install offline.

## 7. Multiplayer **[SPEC, not before the SDK is stable]**

Do not build general multiplayer yet. When added, it is async-first: turn-based and ghost/leaderboard races need only Supabase rows. Real-time rooms use a Cloudflare Durable Object per room (WebSocket, authoritative server tick, max 8 players), exposed as `pipal.room.join(roomId)`, `pipal.room.send(msg)`, `pipal.room.on('state', fn)`. Anything awarding gems from a multiplayer result must be decided by the room's server, never by clients.

## 8. Checklist before shipping a game

- [ ] Works with network disabled after install.
- [ ] No `game.id` branch added to `GameWebViewModal`; behavior declared in `capabilities`.
- [ ] Uses `window.pipal` with feature detection; implements `pause`/`resume`.
- [ ] No client-reported value reaches a gem or mana write.
- [ ] Handles `gemsDenied`, `budget_exhausted`, and a missing wallet.
- [ ] Pauses on `pause` and when the app is backgrounded.
- [ ] Measured on the Samsung A16 over USB, not an emulator.
- [ ] Row added to `games`, thumbnail uploaded, `bundle_url` has a `?v=` bump.

## 9. Reference implementation: Momo King (`ready-set-momo`)
First game on the server-side wallet. With `window.pipal` it never reports a gem balance: it reads `pipal.gems.balance()`, buys cash with `pipal.gems.spend` (cash is granted only after the server confirms), buys gems with `pipal.gems.buy`, and plays one server-timed run per in-game day (`pipal.run.start/end`, score = customers served that day). Without `window.pipal` (old app builds) it falls back to the legacy messages. Faucet config in `games`: `gem_per_score 0.5`, `gem_max_per_run 15`, `gem_user_daily_cap 60`, `gem_daily_budget 3000`, `max_score_per_sec 2`. Gems bought back into in-game cash are a sink (1 gem = Rs 10 of in-game cash), so the faucet is bounded to a few gems a day per player.
