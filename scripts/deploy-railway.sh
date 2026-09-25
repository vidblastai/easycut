#!/usr/bin/env bash
# Finish the Railway deployment. One command, no questions.
#
#   RAILWAY_TOKEN=<your token> bash scripts/deploy-railway.sh
#
# Adds Postgres, attaches a disk, sets the keys, gives the service a public URL
# and waits until the app answers. Safe to run again — every step skips itself
# if it is already done, so a half-finished project can simply be re-run.
#
# ── Why this file exists in this shape ──────────────────────────────────────
#
# The infrastructure half of a deployment — provision a database, mount a
# volume, open a port — is not something a repository can do to itself. It
# needs an authenticated call to the host. Anything that cannot reach
# railway.app has to hand the work to something that can, and this is the
# smallest possible thing to hand over: one line, no decisions, no browser.
#
# It used to ask `railway login`, which opens a browser, and then ask three
# interactive questions. With RAILWAY_TOKEN set the CLI authenticates without
# any of that, which is what turns this from a guided walkthrough into a
# command you paste once.
set -euo pipefail

bold() { printf '\n\033[1m▸ %s\033[0m\n' "$1"; }
dim()  { printf '  \033[2m%s\033[0m\n' "$1"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$1"; }

# Prints the command, then runs it. A wrong flag should be something you can
# see afterwards rather than something that half-applied silently.
run()  { printf '  \033[2m$ %s\033[0m\n' "$*"; "$@"; }

# ── the token ───────────────────────────────────────────────────────────────
if [ -z "${RAILWAY_TOKEN:-}" ] && [ -f .env ]; then
  RAILWAY_TOKEN="$(grep '^RAILWAY_TOKEN=' .env 2>/dev/null | cut -d= -f2- || true)"
  export RAILWAY_TOKEN
fi

if [ -z "${RAILWAY_TOKEN:-}" ]; then
  cat <<'NEEDED'

  No RAILWAY_TOKEN.

  Make one at https://railway.com/account/tokens, then either put it in .env
  as RAILWAY_TOKEN=... or run this as:

      RAILWAY_TOKEN=xxxxxxxx bash scripts/deploy-railway.sh

NEEDED
  exit 1
fi

# ── the CLI ─────────────────────────────────────────────────────────────────
if ! command -v railway >/dev/null 2>&1; then
  bold "Installing the Railway CLI"
  if command -v brew >/dev/null 2>&1; then run brew install railway
  else run npm install -g @railway/cli
  fi
fi
dim "$(railway --version 2>/dev/null || echo 'railway CLI')"

bold "Checking the token"
if railway status >/dev/null 2>&1; then
  ok "linked"
  railway status 2>/dev/null | head -5 || true
else
  warn "The token did not resolve to a project."
  dim "A PROJECT token scopes itself automatically. An ACCOUNT token needs a link:"
  dim "    railway link        # pick EasyCut → production"
  dim "Then run this again."
  exit 1
fi

# ── Postgres ────────────────────────────────────────────────────────────────
bold "Database"
if railway variables 2>/dev/null | grep -q "DATABASE_URL"; then
  ok "DATABASE_URL already present"
else
  run railway add --database postgres || warn "could not add it — do it in the dashboard, then re-run"
  dim "Railway injects DATABASE_URL into the service itself."
fi

# ── the disk ────────────────────────────────────────────────────────────────
# Uploaded footage and finished renders live on a mounted disk. Without one the
# container's filesystem is wiped on every restart, which loses somebody's
# video rather than merely inconveniencing them.
bold "A disk for the footage and the renders"
if railway volume list 2>/dev/null | grep -q "/data"; then
  ok "volume already mounted at /data"
else
  run railway volume add --mount-path /data \
    || warn "this CLI cannot add volumes — Service → Settings → Volumes → mount at /data"
fi

# ── the keys ────────────────────────────────────────────────────────────────
# Only the secrets. QUEUE_DRIVER, STORAGE_DRIVER and STORAGE_LOCAL_DIR are
# baked into the image, because they are the same on every deployment and a web
# form is three more chances to typo them.
bold "API keys"
if [ -f .env ]; then
  for key in DEEPGRAM_API_KEY ANTHROPIC_API_KEY GEMINI_API_KEY PEXELS_API_KEY \
             RESEND_API_KEY CLERK_SECRET_KEY NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY \
             STRIPE_SECRET_KEY STRIPE_WEBHOOK_SECRET ERROR_WEBHOOK_URL SENTRY_DSN; do
    value="$(grep "^${key}=" .env 2>/dev/null | cut -d= -f2- || true)"
    if [ -n "$value" ]; then
      # The value is never printed: this scrolls past in a terminal, and a
      # terminal is a place other people look.
      printf '  \033[2m$ railway variables --set "%s=***"\033[0m\n' "$key"
      railway variables --set "${key}=${value}" >/dev/null 2>&1 \
        && ok "$key" || warn "$key failed"
    fi
  done
  # The director needs telling which provider to use when both keys exist.
  if grep -q '^GEMINI_API_KEY=.' .env 2>/dev/null && ! grep -q '^ANTHROPIC_API_KEY=.' .env 2>/dev/null; then
    railway variables --set "LLM_PROVIDER=gemini" >/dev/null 2>&1 && ok "LLM_PROVIDER=gemini"
  fi
else
  warn "no .env here, so no keys to copy up"
fi

# ── a public URL ────────────────────────────────────────────────────────────
# A Dockerfile service is created unexposed: Railway will not guess that a
# container wants a port open. Without this the app runs perfectly and nobody
# can reach it, which looks exactly like a broken deployment.
bold "A public URL"
DOMAIN="$(railway domain 2>&1 | grep -oE '[a-z0-9.-]+\.up\.railway\.app' | head -1 || true)"
if [ -n "$DOMAIN" ]; then
  ok "https://$DOMAIN"
  run railway variables --set "APP_URL=https://$DOMAIN" || warn "could not set APP_URL"
else
  warn "no domain yet — Service → Settings → Networking → Generate Domain"
fi

# ── ship ────────────────────────────────────────────────────────────────────
bold "Deploying"
dim "The first build takes a few minutes: it installs a headless Chromium."
run railway redeploy --yes 2>/dev/null || run railway up --detach

# ── did it actually come up ─────────────────────────────────────────────────
# Reporting success because a command exited 0 is how deployments get called
# done while being down. This asks the app itself.
if [ -n "$DOMAIN" ]; then
  bold "Waiting for it to answer"
  for i in $(seq 1 60); do
    if curl -sf "https://$DOMAIN/api/health" >/dev/null 2>&1; then
      ok "it is up: https://$DOMAIN"
      echo
      curl -s "https://$DOMAIN/api/health" | head -40
      echo
      exit 0
    fi
    sleep 10
  done
  warn "no answer after ten minutes. Check: railway logs"
fi

cat <<'DONE'

  If anything above said "!", that step needs a click in the dashboard.
  Everything else is done.

    railway logs        watch it boot
    railway open        open the dashboard

DONE
