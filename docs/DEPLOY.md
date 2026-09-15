# Deploying EasyCut

Nothing runs on your laptop. This is what hosting it actually takes.

## Why it is not just "push to Vercel"

Most of EasyCut is an ordinary Next.js app and would deploy anywhere in five
minutes. One part is not: **the worker**. It runs ffmpeg to cut the footage and
drives a headless Chromium to draw every frame of the output. A 45-second short
takes a few minutes of real CPU; a 10-minute video takes far longer.

That rules out serverless for the worker. Vercel functions cap out at 800
seconds on Pro, ship no ffmpeg, and cannot run a browser. So the worker needs a
container on a machine that stays up — and once you have that, four settings
that are fine locally stop being fine:

| Setting | Local | Hosted | Why |
|---|---|---|---|
| `DATABASE_URL` | SQLite file | Postgres | A container filesystem is wiped on every restart and deploy. |
| `STORAGE_DRIVER` | `local` | `s3` | Uploads written by the web container are invisible to the worker container. |
| `QUEUE_DRIVER` | `memory` | `redis` | An in-process queue cannot hand a job to a different container. |
| Prisma `provider` | `sqlite` | `postgresql` | Prisma reads this from the schema file, not an env var. `npm run db:postgres` rewrites it. |

Miss any of those and it deploys, boots, looks healthy, and then loses every
video. `GET /api/health` returns the first three back to you as warnings for
exactly this reason.

---

## The stack

Four services. Everything except the container host has a free tier that covers
early usage comfortably.

| Piece | Service | Cost |
|---|---|---|
| Web + worker containers | **Railway** | ~$5–20/mo depending on worker CPU |
| Postgres | **Neon** | Free to 0.5 GB |
| Object storage | **Cloudflare R2** | Free to 10 GB, **zero egress** |
| Redis queue | **Upstash** | Free to 10k commands/day |

R2 over S3 is the one choice worth defending: every finished video gets
downloaded at least once, and S3 charges for egress while R2 does not. On a
video product that difference compounds.

Railway is the recommendation because it runs a Dockerfile, gives you two
services off one repo, and has a private network between them. **Render** and
**Fly.io** work identically — same image, same env vars.

---

## Steps

### 1. Postgres

Create a project at [neon.tech](https://neon.tech), copy the connection string,
then point the schema at it:

```bash
npm run db:postgres
DATABASE_URL='postgres://...' npx prisma db push
```

Commit the schema change — the Docker build needs it.

### 2. Storage

In the Cloudflare dashboard, R2 → Create bucket (`easycut-media`), then create
an API token with **Object Read & Write**. You need:

```
STORAGE_DRIVER=s3
S3_BUCKET=easycut-media
S3_REGION=auto
S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
S3_PUBLIC_BASE_URL=https://media.yourdomain.com     # or the r2.dev dev URL
```

Uploads go **browser → R2 directly** via a presigned PUT, so a 4 GB file never
passes through your containers. That is already how `POST /api/projects` works;
it only needs the bucket configured.

### 3. Queue

Create a Redis database at [upstash.com](https://upstash.com), copy the
connection URL:

```
QUEUE_DRIVER=redis
REDIS_URL=rediss://...
```

The redis driver loads its client at runtime, so also add `redis` to
dependencies: `npm install redis`.

### 4. The two containers

Point Railway at the repo. It finds the `Dockerfile` and builds one image.
Create **two services from it**:

| Service | Start command | Sizing |
|---|---|---|
| `web` | *(default)* `npm run start` | 0.5 vCPU is plenty |
| `worker` | `npm run worker` | **2+ vCPU** — this is where the time goes |

Both get the same environment variables. Set `APP_URL` to your public web URL.

Give the worker the CPU. The web app serves JSON; the worker encodes video, and
`RENDER_CONCURRENCY` should roughly match its core count.

### 5. Check it

```bash
curl https://your-app.up.railway.app/api/health
```

Want:

```json
{ "status": "ok",
  "checks": { "database": "ok", "storage": "s3", "queue": "redis",
              "director": "gemini", "transcription": "configured" } }
```

A `warnings` array means one of the four switches above is still on its local
default, and you will lose videos.

---

## Scaling the render

Local rendering on the worker is correct and slow — roughly 5× realtime for
1080p. Two ways out when queue depth becomes the complaint:

1. **More workers.** The Redis queue already distributes; add worker replicas.
   Cheapest, and linear.
2. **Remotion Lambda.** Fans frame ranges across AWS Lambda, turning a 10-minute
   render into about two. Costs money per render (~$0.15 for a 10-minute video)
   and needs an AWS account. `RENDER_DRIVER=lambda` plus the
   `REMOTION_LAMBDA_*` variables; setup at
   https://www.remotion.dev/docs/lambda/setup.

Start with option 1. It is a slider, not a migration.

---

## What is still missing before real users

Honest list, in the order it will bite:

- **Authentication.** There is none. Every project is visible to anyone who
  guesses an id. Clerk is the fastest fix and the reference project already
  uses it.
- **Per-user quotas.** The budget guard caps cost per *video*, not per account.
  One user with a script could run up a bill.
- **A cleanup job.** Source uploads are never deleted, and they are the bulk of
  your storage. R2 lifecycle rules on the `sources/` prefix handle it.
- **Error reporting.** Failures land in container logs and nowhere else.
