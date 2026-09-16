#!/usr/bin/env bash
# EasyCut, on your own machine.
#
#   bash start.sh            install, ask for three free keys, open the app
#   bash start.sh --demo     no keys, no signups — builds a finished video first
#
# Safe to run again either way; it skips whatever is already done.
set -euo pipefail

DEMO=0
for arg in "$@"; do
  case "$arg" in
    --demo) DEMO=1 ;;
    -h|--help) sed -n '2,7p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $arg (try --demo)"; exit 1 ;;
  esac
done

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

# ── a browser to draw the frames ────────────────────────────────────────────
# Remotion draws every output frame in a headless Chromium. Left alone it
# downloads its own — about 150 MB, once, and a silent four-minute pause the
# first time you render, which looks exactly like a hang. If this machine
# already has Chrome, point at that instead: nothing to download, nothing to
# explain.
find_browser() {
  local c
  for c in \
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
    "/Applications/Chromium.app/Contents/MacOS/Chromium" \
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" \
    "$(command -v google-chrome 2>/dev/null || true)" \
    "$(command -v google-chrome-stable 2>/dev/null || true)" \
    "$(command -v chromium 2>/dev/null || true)" \
    "$(command -v chromium-browser 2>/dev/null || true)" \
    /opt/pw-browsers/chromium_headless_shell-*/chrome-linux/headless_shell
  do
    [ -n "$c" ] && [ -x "$c" ] && { printf '%s' "$c"; return 0; }
  done
  return 1
}
BROWSER="$(find_browser || true)"

# ── dependencies ────────────────────────────────────────────────────────────
if [ ! -d node_modules ]; then
  bold "Installing (a few minutes, once)"
  npm install
fi

# ── keys ────────────────────────────────────────────────────────────────────
# In demo mode nothing is asked for. Someone who wants to see what this is
# should not have to open three signup pages first, and every key is optional
# by design — without them the video loses layers, it does not fail.
if [ ! -f .env ] && [ "$DEMO" = "1" ]; then
  cat > .env <<ENV
APP_URL=http://localhost:3000
DATABASE_URL="file:./dev.db"

# No keys. The edit still happens — it just cuts on silence rather than on
# words, and the B-roll layer sits this one out. Add keys and re-run any time.
LLM_PROVIDER=gemini
QUEUE_DRIVER=db
STORAGE_DRIVER=local
RENDER_DRIVER=local
BROWSER_EXECUTABLE=${BROWSER}
ENV
fi

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
# Blank means Remotion downloads its own Chromium on the first render.
BROWSER_EXECUTABLE=${BROWSER}
ENV
  echo
  echo "  Saved to .env — that file never leaves this machine."
fi

# ── database and sound effects ──────────────────────────────────────────────
if [ ! -f prisma/dev.db ] && [ ! -f dev.db ]; then
  bold "First-time setup"
  npm run setup
fi

# ── a video to look at ──────────────────────────────────────────────────────
if [ "$DEMO" = "1" ]; then
  bold "Making a sample video (a couple of minutes, once)"
  echo "  Real footage, the real pipeline, a real render — so the dashboard has"
  echo "  something in it rather than being empty the first time you open it."
  if [ -z "$BROWSER" ]; then
    warn "No Chrome found, so the first render downloads one (~150 MB). It will"
    warn "look stuck for a few minutes. That happens once."
  fi
  npm run db:seed
fi

# ── go ──────────────────────────────────────────────────────────────────────
bold "Starting — give it about twenty seconds, then open:"
printf '\n      \033[1;35mhttp://localhost:3000\033[0m\n\n'

# Nudge the browser open once the server is actually listening, rather than
# immediately onto a connection-refused page.
(
  # `set -e` applies in here too, so a bare `command -v open && open …` ended
  # the subshell the moment `open` was missing — which is every Linux machine,
  # where the xdg-open line below it was therefore never reached.
  set +e
  for _ in $(seq 1 60); do
    if curl -sf http://127.0.0.1:3000/api/health >/dev/null 2>&1; then
      if command -v open >/dev/null 2>&1; then open http://localhost:3000
      elif command -v xdg-open >/dev/null 2>&1; then xdg-open http://localhost:3000
      fi
      break
    fi
    sleep 1
  done
) >/dev/null 2>&1 &

npm run dev
