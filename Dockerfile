# EasyCut — one image, two roles.
#
# The web app and the worker share a codebase, a Prisma client and a set of
# provider adapters, so they ship as one image and differ only in CMD. Two
# images would mean two builds to keep in step, and the day they drift is the
# day the worker deserialises an EDL the web app cannot write.
#
#   docker build -t easycut .
#   docker run -e DATABASE_URL=... easycut                  # web
#   docker run -e DATABASE_URL=... easycut npm run worker   # worker
#
# The worker is the one that needs the machine: ffmpeg cuts the footage and a
# headless Chromium draws every frame. Give it CPU, not memory.

FROM node:22-bookworm-slim AS base

# Chromium's shared libraries. Remotion drives a real browser to render frames,
# and a slim image is missing most of what one links against — the failure is a
# silent launch timeout rather than a missing-package error, so these are not
# optional.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates fonts-liberation libasound2 libatk-bridge2.0-0 libatk1.0-0 \
      libatspi2.0-0 libcairo2 libcups2 libdbus-1-3 libdrm2 libgbm1 libglib2.0-0 \
      libnspr4 libnss3 libpango-1.0-0 libx11-6 libxcb1 libxcomposite1 libxdamage1 \
      libxext6 libxfixes3 libxkbcommon0 libxrandr2 xdg-utils \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production

# ---------------------------------------------------------------- deps ----
FROM base AS deps
COPY package.json package-lock.json* ./
COPY prisma ./prisma
# Dev dependencies ship to the runtime stage too, on purpose: the image runs
# `tsx` for the worker and for the sound-effect generation below, and both are
# dev dependencies. An earlier comment here promised a prune that never existed.
RUN npm ci --include=dev

# --------------------------------------------------------------- build ----
FROM deps AS build
COPY . .

# Postgres, not SQLite, and this has to happen BEFORE `prisma generate`.
#
# Prisma resolves the database type from the schema FILE at generate time and
# will not read it from an environment variable, so an image generated against
# sqlite cannot talk to a Postgres DATABASE_URL however correct that URL is.
# The failure arrives at runtime, on the first query, long after the build went
# green — which is the worst possible moment to find out.
#
# The deploy guide used to say "run `npm run db:postgres` locally and commit
# it". That is one manual step between a working repo and a broken deployment,
# and it was duly forgotten. A container is always a deployment, so it decides
# for itself; local development keeps SQLite untouched.
#
#   docker build --build-arg DB_PROVIDER=sqlite .   # if you really want it
ARG DB_PROVIDER=postgresql
RUN if [ "$DB_PROVIDER" = "postgresql" ]; then npm run db:postgres; fi

RUN npx prisma generate && npm run build

# Remotion downloads its own Chromium on first render. Doing it here means the
# first video a user renders is not also the one that waits for a 150MB
# download on a cold container.
#
# It lands in `node_modules/.remotion`, NOT in a home-directory cache —
# `getDownloadsCacheDir()` walks up from the cwd to the nearest package.json and
# puts it there. That is why the runtime stage needs no separate COPY for it:
# the `node_modules` copy below already carries the browser with it.
RUN npx remotion browser ensure

# ------------------------------------------------------------- runtime ----
FROM base AS runtime

# ffmpeg and ffprobe arrive as npm packages (ffmpeg-static / ffprobe-static), so
# there is nothing to apt-get — the binaries come with node_modules.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/next.config.* ./
COPY --from=build /app/src ./src
COPY --from=build /app/remotion ./remotion
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/content ./content
COPY --from=build /app/tsconfig.json ./tsconfig.json

# Sound effects are synthesised, not shipped — a few hundred KB of ffmpeg output
# rather than a binary blob in git.
RUN npx tsx scripts/generate-sfx.ts || true

EXPOSE 3000

# The settings that are not secrets live HERE, not in the host's dashboard.
#
# Every one of these is the same on any container deployment, so making a
# person type them into a web form is three chances to typo something and one
# more thing to forget. A secret still has to come from the environment —
# these do not.
#
#   QUEUE_DRIVER=db      the web server and the worker share work through the
#                        database, which is what removes Redis from the picture
#   STORAGE_DRIVER=local a mounted disk, not S3 — see STORAGE_LOCAL_DIR
#   STORAGE_LOCAL_DIR    where the volume gets mounted; override if you mount
#                        it somewhere else
#
# All three are still overridable: a variable set on the host wins over ENV.
ENV PORT=3000 HOSTNAME=0.0.0.0 \
    QUEUE_DRIVER=db \
    STORAGE_DRIVER=local \
    STORAGE_LOCAL_DIR=/data

# Render hosts sit behind load balancers that health-check before routing.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# One container running both roles, sharing work through the database queue.
# Override to `npm run start` + a separate `npm run worker` service to split them.
CMD ["npm", "run", "start:all"]
