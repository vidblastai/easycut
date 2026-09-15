#!/usr/bin/env bash
# EasyCut, on your own machine.
#
#   bash start.sh
#
# Installs what is missing, asks for the three API keys the first time, and
# opens the app in your browser. Safe to run again — it skips whatever is
# already done.
set -euo pipefail

bold() { printf '\n\033[1m%s\033[0m\n' "$1"; }
warn() { printf '\033[33m  %s\033[0m\n' "$1"; }

# ── node ────────────────────────────────────────────────────────────────────
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Get it from https://nodejs.org (pick the LTS button), then run this again."
  exit 1
fi
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "Node $NODE_MAJOR is too old — this needs 20 or newer. Update at https://nodejs.org and run this again."
  exit 1
fi

# ── ffmpeg ──────────────────────────────────────────────────────────────────
# Comes from npm (ffmpeg-static), so there is nothing to install by hand. Said
# out loud because every other video tool asks you to.

# ── dependencies ────────────────────────────────────────────────────────────
if [ ! -d node_modules ]; then
  bold "Installing (a few minutes, once)"
  npm install
fi

# ── keys ────────────────────────────────────────────────────────────────────
if [ ! -f .env ]; then
  bold "Three API keys, all free"
  echo "  Paste each one and press enter. Leave blank to skip — the app still"
  echo "  runs, it just loses that layer."
  echo

  read -r -p "  Deepgram (console.deepgram.com/signup) — captions and cutting the ums: " DEEPGRAM
  read -r -p "  Gemini   (aistudio.google.com/apikey)   — picks the hook and the B-roll: " GEMINI
  read -r -p "  Pexels   (pexels.com/api)               — stock B-roll: " PEXELS

  cat > .env <<ENV
APP_URL=http://localhost:3000
DATABASE_URL="file:./dev.db"

DEEPGRAM_API_KEY=${DEEPGRAM}
GEMINI_API_KEY=${GEMINI}
PEXELS_API_KEY=${PEXELS}
LLM_PROVIDER=gemini

# Two processes share work through the database, so both see the same jobs.
QUEUE_DRIVER=db
STORAGE_DRIVER=local
RENDER_DRIVER=local
ENV
  echo
  echo "  Saved to .env — that file never leaves this machine."
fi

# ── database and sound effects ──────────────────────────────────────────────
if [ ! -f prisma/dev.db ] && [ ! -f dev.db ]; then
  bold "First-time setup"
  npm run setup
fi

# ── go ──────────────────────────────────────────────────────────────────────
bold "Starting — give it about twenty seconds, then open:"
printf '\n      \033[1;35mhttp://localhost:3000\033[0m\n\n'

# Nudge the browser open once the server is actually listening, rather than
# immediately onto a connection-refused page.
(
  for _ in $(seq 1 40); do
    if curl -sf http://127.0.0.1:3000/api/health >/dev/null 2>&1; then
      command -v open >/dev/null 2>&1 && open http://localhost:3000
      command -v xdg-open >/dev/null 2>&1 && xdg-open http://localhost:3000
      break
    fi
    sleep 1
  done
) &

npm run dev
