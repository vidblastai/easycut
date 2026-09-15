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

You will need a GitHub account and a card. About fifteen minutes.

**There is a script**: `bash scripts/deploy-railway.sh` does steps 1–7 below.
It has to run somewhere with a browser, because `railway login` opens one — your
laptop, not a remote container. It prints every command before running it, so a
wrong flag is visible rather than half-applied.

Written against Railway's documented commands but not executed end to end, so
if a step fails, the manual path below is the ground truth. Volumes are a
dashboard click either way.

**1. Point the database at Postgres.** Run this once, locally, and commit it —
Prisma reads the database type from a file, not an environment variable:

```bash
npm run db:postgres
git commit -am "Use Postgres"
git push
```

**2. Make a Railway project.** [railway.app](https://railway.app) → sign in with
GitHub → **New Project** → **Deploy from GitHub repo** → pick `easycut`.

It finds `railway.json`, builds the Dockerfile, and sets the start command and
health check itself.

**3. Add the database.** In the same project: **New** → **Database** →
**PostgreSQL**. Railway wires `DATABASE_URL` in automatically.

**4. Add a disk for the videos.** On the app service: **Settings** → **Volumes**
→ mount at `/data`.

**5. Set the variables.** On the app service, **Variables**:

```
QUEUE_DRIVER=db
STORAGE_DRIVER=local
STORAGE_LOCAL_DIR=/data
DEEPGRAM_API_KEY=...
GEMINI_API_KEY=...
PEXELS_API_KEY=...
LLM_PROVIDER=gemini
APP_URL=https://<your-app>.up.railway.app
```

**6. Generate a domain.** **Settings** → **Networking** → **Generate Domain**.
Put that URL in `APP_URL` and redeploy.

**7. Check it.**

```
https://<your-app>.up.railway.app/api/health
```

Want `"status": "ok"` with `"queue": "db"` and `"transcription": "configured"`.
The `warnings` array tells you what is still on a local default.

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
