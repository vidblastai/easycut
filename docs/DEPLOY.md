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
| `QUEUE_DRIVER` | `memory` | `db` | An in-process queue cannot hand a job to another process. `db` needs nothing new; `redis` is for later. |
| Prisma `provider` | `sqlite` | `postgresql` | Prisma reads this from the schema file, not an env var. `npm run db:postgres` rewrites it. |

Miss any of those and it deploys, boots, looks healthy, and then loses every
video. `GET /api/health` returns the first three back to you as warnings for
exactly this reason.

---

## The simplest thing that works: one account

You do not need four services to put this online. Start here:

**Railway, and nothing else.** One project, one service, ~$5–20/month.

| Piece | How | Extra signup |
|---|---|---|
| Web + worker | One container, `npm run start:all` | — |
| Database | Railway's Postgres add-on, same project | — |
| Video files | A Railway volume mounted at `/data` | — |
| Queue | The database — no Redis | — |

```
DATABASE_URL=${{Postgres.DATABASE_URL}}   # Railway fills this in
QUEUE_DRIVER=db
STORAGE_DRIVER=local
STORAGE_LOCAL_DIR=/data
```

Set the start command to `npm run start:all`. It runs the web server and the
worker as two processes in the one container; they share work through the
database rather than memory, which is what removes Redis from the picture.

That is the whole deployment. It runs one video at a time, and a restart
mid-render loses that job — fine while you are the only user, and the reason to
move on is queueing, not correctness.

## When to add the rest

Each of these solves a problem you will actually have, and none of them before
then:

| Add | When | Why |
|---|---|---|
| **Cloudflare R2** | Storage bill or a second container | A volume attaches to one service, so the moment there are two, they cannot see each other's files. R2 is free to 10 GB with no egress charge — which matters because every finished video gets downloaded. |
| **Separate worker service** | Renders queue behind each other | Scale video CPU without scaling the web app, and a web deploy stops killing an in-flight render. |
| **Upstash Redis** | Several workers, or the database queue's polling shows up in your bill | The database queue handles a handful of workers fine. Redis earns its place when there are many, or when a 400ms poll per idle worker stops being free. |
| **Neon Postgres** | Only if you leave Railway | Railway's own Postgres is fine. Neon is here because its free tier is generous and it is not tied to your host. |

The full four-service setup is below for when you get there.

## The full stack, later

| Piece | Service | Cost |
|---|---|---|
| Web + worker containers | **Railway** | ~$5–20/mo |
| Postgres | **Neon** | Free to 0.5 GB |
| Object storage | **Cloudflare R2** | Free to 10 GB, **zero egress** |
| Redis queue | **Upstash** | Free to 10k commands/day |

**Render** and **Fly.io** work identically — same image, same env vars.

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
