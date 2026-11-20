#!/usr/bin/env bash
# Deploys every game in games/ to the existing Pipal Cloudflare Pages project (pipal-games).
# Needs Cloudflare auth for the Pipal account: `npx wrangler login`, or CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID.
set -euo pipefail
cd "$(dirname "$0")/.."
node scripts/games-manifest.js
npx wrangler pages deploy games --project-name=pipal-games --branch=main --commit-dirty=true
echo
echo "Deployed. If a game's files changed, bump ?v= in Supabase games.bundle_url (see CLAUDE.md)."
