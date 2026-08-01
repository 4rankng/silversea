# Staging redeploy runbook — vantai.tingting.vip

**Why this exists.** On 2026-08-01 the customer-master seed (Silver Sea +
Long Minh) was applied to the staging DB and verified, but the **code
redeploy** (which brings the new accounting schema + `operational_sites` +
factory sites) could not be completed in-session because of two
machine-credential blockers that only the operator can resolve. This file
is the exact, copy-pasteable sequence to finish the job.

Current staging state after the 2026-08-01 session:

| Layer | State |
|---|---|
| DB migrations applied | 156 (matches the running image's bundled set, latest 0165 in journal idx) |
| Running backend image | `franknguyenvd/transting-backend:latest` (built 2026-07-29) — bundles up to migration **0165** |
| Local HEAD migrations | **0174** (9 newer: 0166–0174; `operational_sites` is **0170**) |
| Server compose image refs | `franknguyenvd/*` (Docker Hub) — **mismatched** with the repo's `make demo` which pushes `ghcr.io/4rankng/*` |
| Silver Sea + Long Minh seed | ✅ applied (see `deploy/seed-staging-quytrinh.sql`) |
| Long Minh factory sites | ⏸ deferred — needs `operational_sites` (migration 0170); SQL staged in `deploy/seed-staging-quytrinh-sites.sql` |
| Server RAM | 961 MiB — too small to build images on-server; build locally + push |

## Blockers (operator action required)

1. **GHCR push scope.** `gh auth status` shows scopes
   `admin:public_key gist read:org repo` — **no `write:packages`**. The
   Makefile's `gh auth token | docker login ghcr.io …` step will push-fail.
   Fix:
   ```sh
   gh auth refresh -h github.com -s write:packages
   ```
2. **Server image registry mismatch.** `/opt/vantai/deploy/docker-compose.prod.yml`
   pulls `franknguyenvd/*` (Docker Hub); the repo pipeline pushes
   `ghcr.io/4rankng/*`. Pick **one** canonical home for the images and align
   both sides. The repo already standardizes on GHCR, so the server should
   be moved to GHCR (steps below). If you prefer to keep Docker Hub, instead
   change `backend/Makefile` and `frontend/Makefile` `IMAGE_NAME` to
   `franknguyenvd/...` and log in to Docker Hub before building.

## Option A — move server to GHCR (recommended, matches repo)

```sh
# 0. one-time: add the missing scope
gh auth refresh -h github.com -s write:packages

# 1. align the server compose image refs (idempotent — preserves volumes/env/passwords)
ssh root@vantai.tingting.vip 'cp /opt/vantai/deploy/docker-compose.prod.yml \
  /opt/vantai/deploy/docker-compose.prod.yml.bak.$(date +%Y%m%d-%H%M%S) && \
  sed -i "s#franknguyenvd/transting-backend:latest#ghcr.io/4rankng/transting-backend:latest#g; \
          s#franknguyenvd/transting-frontend:latest#ghcr.io/4rankng/transting-frontend:latest#g" \
  /opt/vantai/deploy/docker-compose.prod.yml && \
  grep "image:" /opt/vantai/deploy/docker-compose.prod.yml'

# 2. from repo root: build, push, pull on server, migrate, recreate, health-check
make demo
```

`make demo` runs `drizzle-kit migrate` in the **pulled** image **before**
cutover, so migrations 0166–0174 (including `operational_sites`) apply first.
The DB volume is never touched, so the existing 97 demo trips and the
Long Minh seed persist.

## Option B — keep Docker Hub

```sh
# 0. log in to Docker Hub (you'll be prompted for user/pass)
docker login

# 1. temporarily retarget the Makefiles to Docker Hub (do NOT commit unless you decide to keep it)
#    edit backend/Makefile + frontend/Makefile: IMAGE_NAME := franknguyenvd/transting-backend / -frontend

# 2. build + push to Docker Hub, then pull/migrate/restart on server
make demo
```

## After the redeploy succeeds — apply the factory sites

Once `make demo` completes (health green), `operational_sites` exists:

```sh
ssh root@vantai.tingting.vip 'docker exec -i vantai-postgres-1 psql -U vantai -d vantai' \
  < deploy/seed-staging-quytrinh-sites.sql
```

This inserts the 8 Long Minh sites (NEWEB-KHO 1/2/3, ASKEY-Xưởng 1/2,
SUNRISE, SJ Tech, S-CONNECT) with addresses, tax codes, lift-fee invoice
names, and strict on-site rules — all from `docs/quytrinh/.../DATA PM.xlsx`.

## Verify

```sh
# migrations now include 0170
ssh root@vantai.tingting.vip 'docker exec vantai-postgres-1 psql -U vantai -d vantai -c \
  "SELECT count(*) FROM drizzle.__drizzle_migrations"'

# factory sites present
ssh root@vantai.tingting.vip 'docker exec vantai-postgres-1 psql -U vantai -d vantai -c \
  "SELECT code, name, site_type, is_active FROM operational_sites WHERE customer_id=(SELECT id FROM customers WHERE tax_code=\"2300540419\") ORDER BY code"'

# health
curl -fsS https://vantai.tingting.vip/api/health
```

## Rollback notes

- The seed SQL is additive and idempotent; it does not need rolling back.
- A bad image redeploy can be reverted by `docker compose ... up -d` with
  the previous image tag. Keep the compose `.bak.*` files on the server.
- The DB volume (`/opt/vantai/data/postgres`) is never wiped by `make demo`,
  so a failed migrate/recreate does not lose data. If a migration fails
  partway, Drizzle's `__drizzle_migrations` journal + transactional SQL keep
  the DB consistent; fix the offending migration and re-run `make demo-deploy`.
