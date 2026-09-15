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
# Dev dependencies are needed to build; the runtime stage takes only node_modules
# that survive the prune below.
RUN npm ci --include=dev

# --------------------------------------------------------------- build ----
FROM deps AS build
COPY . .
RUN npx prisma generate && npm run build

# Remotion downloads its own Chromium on first render. Doing it here means the
# first video a user renders is not also the one that waits for a 150MB
# download on a cold container.
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
# The browser Remotion fetched during build.
COPY --from=build /root/.cache/remotion /root/.cache/remotion

# Sound effects are synthesised, not shipped — a few hundred KB of ffmpeg output
# rather than a binary blob in git.
RUN npx tsx scripts/generate-sfx.ts || true

EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0

# Render hosts sit behind load balancers that health-check before routing.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npm", "run", "start"]
