#!/usr/bin/env bash
# Deploy EasyCut to Railway.
#
#   bash scripts/deploy-railway.sh
#
# Run this from a machine with a browser — `railway login` opens one. That means
# your laptop, via the Claude desktop app or your own terminal; it cannot run
# from a remote container that has no browser to hand you.
#
# It prints every command before running it and stops on the first failure, so
# a wrong flag is something you see rather than something that half-creates a
# project. If a step fails, the manual click-path in docs/DEPLOY.md does the
# same thing.
set -euo pipefail

say()  { printf '\n\033[1m▸ %s\033[0m\n' "$1"; }
run()  { printf '  \033[2m$ %s\033[0m\n' "$*"; "$@"; }
ask()  { read -r -p "  $1 [y/N] " reply; [[ "$reply" =~ ^[Yy]$ ]]; }

# ── 0. the CLI ──────────────────────────────────────────────────────────────
if ! command -v railway >/dev/null 2>&1; then
  say "Installing the Railway CLI"
  if command -v brew >/dev/null 2>&1; then run brew install railway
  else run npm install -g @railway/cli
  fi
fi
run railway --version

# ── 1. Postgres in the schema ───────────────────────────────────────────────
# Prisma reads the database type from schema.prisma, not an env var, so this
# has to be committed before the image is built.
if grep -q 'provider = "sqlite"' prisma/schema.prisma; then
  say "Switching Prisma to Postgres"
  run npm run db:postgres
  run git add prisma/schema.prisma
  run git commit -m "Use Postgres for the deployment"
  run git push
else
  say "Prisma already targets Postgres"
fi

# ── 2. account ──────────────────────────────────────────────────────────────
say "Signing in to Railway (this opens your browser)"
railway whoami >/dev/null 2>&1 || run railway login

# ── 3. project ──────────────────────────────────────────────────────────────
if [ -f .railway/config.json ] || railway status >/dev/null 2>&1; then
  say "Already linked to a Railway project"
  run railway status
else
  say "Creating the project"
  run railway init --name easycut
fi

# ── 4. database ─────────────────────────────────────────────────────────────
say "Adding Postgres"
# Railway injects DATABASE_URL into the app service itself.
run railway add --database postgres || echo "  (already present, or add it in the dashboard)"

# ── 5. settings ─────────────────────────────────────────────────────────────
say "Setting the variables that are not secrets"
run railway variables \
  --set "QUEUE_DRIVER=db" \
  --set "STORAGE_DRIVER=local" \
  --set "STORAGE_LOCAL_DIR=/data" \
  --set "LLM_PROVIDER=gemini" \
  --set "NODE_ENV=production"

say "Setting the API keys from your local .env"
if [ -f .env ]; then
  for key in DEEPGRAM_API_KEY GEMINI_API_KEY PEXELS_API_KEY CLERK_SECRET_KEY NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY; do
    value="$(grep "^${key}=" .env 2>/dev/null | cut -d= -f2- || true)"
    if [ -n "$value" ]; then
      # Printed without the value — this scrolls past in a terminal others may see.
      printf '  \033[2m$ railway variables --set "%s=***"\033[0m\n' "$key"
      railway variables --set "${key}=${value}"
    else
      echo "  skipping ${key} (not in .env)"
    fi
  done
else
  echo "  no .env found — set the keys in the Railway dashboard"
fi

# ── 6. disk ─────────────────────────────────────────────────────────────────
say "A disk for the uploads and renders"
echo "  The CLI's volume support has moved around between versions, so this one"
echo "  is a dashboard click: Service → Settings → Volumes → mount at /data"
ask "Done that?" || echo "  (carrying on — without it, videos vanish on restart)"

# ── 7. ship ─────────────────────────────────────────────────────────────────
say "Deploying (first build takes a few minutes — it installs Chromium)"
run railway up --detach

say "Giving it a public URL"
run railway domain

cat <<'DONE'

  Next:
    railway logs            watch it boot
    railway open            open the dashboard

  Then visit  <your-url>/api/health  — you want "status": "ok".
  Set APP_URL to that URL in the Railway variables and redeploy.
DONE
