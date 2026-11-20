# Game Bundle Deployment

This app loads web games from the `games` Supabase table. Active rows are fetched by `fetchGameCatalog()` in `lib/games-service.ts`, then opened in `GameWebViewModal` through the row's `bundle_url`.

## Current Hosting

Games are hosted on Cloudflare Pages:

```text
https://pipal-games.pages.dev/
```

## Deploy A Game

1. Build the game as a self-contained HTML page.
2. Place it at:

```text
games/<game-name>/index.html
```

3. Deploy the games directory:

```bash
npx wrangler pages deploy games --project-name=pipal-games --branch=main --commit-dirty=true
```

4. Add or update the Supabase `games` row with `active = true` and `bundle_url` pointing at the hosted URL.

## Supabase Row

Example insert:

```sql
insert into games (
  id,
  title,
  description,
  bundle_url,
  thumbnail_url,
  category,
  tags,
  coins_reward_max,
  sort_order,
  active
) values (
  'my-new-game',
  'My New Game',
  'One-line description shown in the game list',
  'https://pipal-games.pages.dev/my-new-game/',
  null,
  'arcade',
  '{}',
  100,
  10,
  true
);
```

Example update:

```sql
update games
set
  bundle_url = 'https://pipal-games.pages.dev/air-raid/',
  active = true,
  updated_at = now()
where id = 'air-raid';
```

If the app still shows an older bundle after deploy, cache-bust the URL:

```sql
update games
set
  bundle_url = 'https://pipal-games.pages.dev/air-raid/?v=20260629-2',
  updated_at = now()
where id = 'air-raid';
```

`GameWebViewModal` enables WebView caching for URL-based games, so query-string cache busting is the quickest way to force a fresh load.

## Gem Wallet (Shared Across Games)

Gems are a persistent cross-game currency stored in the `game_saves` table (`balance` column). They are separate from Mana.

- **Buying gems:** 1 Mana = 10 Gems, debited via `manaService.spendOnGems()`.
- **Persisting gems:** On modal close, `gamesService.setGemBalance(n)` overwrites `game_saves.balance` with the final in-game gem count. This is a set, not an add — so the balance is always authoritative.
- **Loading gems:** When `GameWebViewModal` becomes visible it calls `gamesService.getSaves()` immediately (via `useEffect`) and seeds the header gem count. This happens for all games regardless of whether the game HTML sends a `getManaBalance` message.
- **Gem wallet activation:** The wallet activates only when a `buyGems` message is received. Loading gems on open for header display does **not** activate it. Games like Air Raid that never send `buyGems` never activate the wallet — their `stats`/`gameOver` `coins` field is ignored for gem purposes, the header stays at the saved balance, and `setGemBalance` is never called on close. The session summary is also suppressed for non-wallet games.

### DB functions

| Function | Signature | Purpose |
|---|---|---|
| `get_game_saves` | `() → jsonb` | Returns `{ balance, lifetime_earned, lifetime_spent }` for the current user |
| `set_gem_balance` | `(p_balance int) → jsonb` | Overwrites current balance; safe to call on every close |
| `spend_gems` | `(p_amount int) → jsonb` | Debits gems; returns `insufficient_gems` if balance too low |
| `earn_gems` | `(p_amount int) → jsonb` | Credits gems (additive) |

All functions are `SECURITY DEFINER` and scoped to `auth.uid()`.

### Service methods (`lib/games-service.ts`)

```ts
gamesService.getSaves()          // read balance
gamesService.setGemBalance(n)    // overwrite balance on close
gamesService.spendGems(n)        // debit (used internally if needed)
gamesService.earnGems(n)         // credit (used internally if needed)
```

### Ball Drop — gem flow

Ball Drop (`games/ball-drop/index.html`) uses the gem wallet as its only currency:

1. On load it sends `{ type: 'getManaBalance' }` → modal responds with `{ type: 'manaBalance', balance, gemBalance }`.
2. If `gemBalance > 0` the game auto-starts with those gems pre-loaded (skips the "BUY GEMS" screen).
3. Player buys more gems → game sends `{ type: 'buyGems', mana: N }` → modal debits Mana and responds `{ type: 'gemsGranted', gems, manaBalance }`.
4. `stats` messages keep `lastKnownGemBalanceRef` current throughout play.
5. On close → `setGemBalance(lastKnownGemBalanceRef.current)` persists remaining gems.

### Air Raid — gem display only

Air Raid does **not** send `getManaBalance` and does not use the gem wallet during gameplay. Its `coins` field in `stats`/`gameOver` is its own in-game pickup counter, not gems.

The modal loads saved gems on open (`useEffect` → `getSaves()`) for header display only — this does **not** activate the gem wallet. The wallet only activates when a `buyGems` message is received. Because Air Raid never sends `buyGems`:

- `stats`/`gameOver` coins never overwrite `lastKnownGemBalanceRef`
- The header gem count stays at the saved value throughout the session
- `setGemBalance` is never called on close
- The session summary is never shown — the modal closes immediately
- Air Raid cannot accidentally zero out the player's gem balance

## WebView Message Contract

Games communicate with the app through `window.ReactNativeWebView.postMessage()`.

Required when the game ends:

```js
window.ReactNativeWebView.postMessage(JSON.stringify({
  type: "gameOver",
  score: 42,
  combo: 3,
  duration_ms: 45000,
  coins: 10        // in-game coins/gems remaining (gem-wallet games only)
}));
```

Optional live HUD updates (sent to keep the modal header in sync):

```js
window.ReactNativeWebView.postMessage(JSON.stringify({
  type: "stats",
  score: 10,
  coins: 5,        // current gem balance (gem-wallet games) or in-game coins (others)
  timer: 90,
  fuel: 80,
  targets: 3,
  kills: 1,
  health: 75
}));
```

Gem purchase flow (gem-wallet games only):

```js
// Game → app: request Mana balance and saved gem balance
window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'getManaBalance' }));
// App → game: { type: 'manaBalance', balance: <mana>, gemBalance: <gems> }

// Game → app: spend Mana to buy gems
window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'buyGems', mana: 10 }));
// App → game (success): { type: 'gemsGranted', gems: 100, manaBalance: 990 }
// App → game (failure): { type: 'gemsDenied', error: 'insufficient_mana' }

// App → game: open the buy-gems overlay (triggered by tapping 💎 in the modal header)
// { type: 'openBuyGems' }
```

Haptics (fire-and-forget, no response):

```js
// Game → app: trigger a native haptic
window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'haptic', style: 'light' }));
// style: 'light' | 'medium' | 'heavy' | 'success' | 'warning' | 'selection'
```

Message types are lower camelCase: `gameOver`, `stats`, `getManaBalance`, `buyGems`, `gemsGranted`, `gemsDenied`, `openBuyGems`, `manaBalance`, `haptic`.

## Air Raid Source Flow

Air Raid is a self-contained game bundle:

```text
games/air-raid/index.html
```

The legacy balloon page and its generator have been retired. Edit the
self-contained bundle directly, then deploy:

```bash
npx wrangler pages deploy games --project-name=pipal-games --branch=main --commit-dirty=true
```

## Reward Notes

For Mana-rewarding games (non-gem-wallet), `GameWebViewModal` submits `score`, `combo`, and `duration_ms` to `gamesService.claimReward()` on `gameOver`. The backend RPC `claim_game_reward` validates the run and awards Mana.

For gem-wallet games (`rewardsGems: true`), there is no Mana reward at session end — the player's profit is their remaining gem balance, persisted via `setGemBalance`.

When adding a new game, decide upfront which economy it uses and set `rewardsGems` accordingly in the `openGame` call in `app/mana/index.tsx`.
