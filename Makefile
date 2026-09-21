.PHONY: dev stop down setup migrate generate build help \
        db-backup db-recreate db-drift-check devdb devdb-prod devdb-sync stgdb \
        demo deploy deploy-advance deploy-db-backup deploy-seed deploy-server-setup

# ─── Ports ─────────────────────────────────────────────────────────────────────
# PostgreSQL: 5441  |  Redis: 6391  |  Backend: 3002  |  Frontend: 7175  |  Adminer: 8083
# Deliberately off the common defaults so this stack can run alongside other
# projects on this machine without port or container-name collisions.

# ─── Full dev environment ─────────────────────────────────────────────────────
dev: ## Start everything (db, redis, backend, frontend)
	@echo "Starting silversea dev environment..."
	@docker compose -f docker-compose.dev.yml up -d --wait 2>/dev/null || \
		docker-compose -f docker-compose.dev.yml up -d
	@echo "Waiting for database (port 5441)..."
	@until pg_isready -h localhost -p 5441 -U postgres >/dev/null 2>&1 || \
		nc -z localhost 5441 >/dev/null 2>&1; do sleep 1; done
	@sleep 1
	@echo "Running migrations (backup first)..."
	@$(MAKE) --no-print-directory db-backup || echo "⚠️  db-backup failed — continuing dev startup WITHOUT a pre-migrate backup" >&2
	@out=$$(cd backend && npx drizzle-kit migrate 2>&1); migrate_status=$$?; \
		printf '%s\n' "$$out" | grep -v "already exists, skipping" || true; \
		if [ $$migrate_status -ne 0 ]; then \
			echo "⚠️  drizzle-kit migrate FAILED (exit $$migrate_status) — dev stack continues, but the DB may be behind. Run 'make migrate' for the full error." >&2; \
		fi
	@echo ""
	@echo "Starting backend (port 3002) and frontend (port 7175)..."
	@echo "  Frontend: http://localhost:7175"
	@echo "  Backend:  http://localhost:3002/api/health"
	@echo "  Adminer:  http://localhost:8083  (DB: silversea · user/pass: postgres/postgres)"
	@echo "  (Ctrl-C stops backend + frontend; db/redis keep running)"
	@pid=$$(lsof -ti tcp:7175 -sTCP:LISTEN 2>/dev/null); \
	if [ -n "$$pid" ]; then \
		echo "Port 7175 in use (stale PID $$pid) — freeing..."; \
		kill $$pid 2>/dev/null || true; \
		sleep 1; \
		kill -9 $$pid 2>/dev/null || true; \
	fi
	@bash -c '\
		trap "kill 0" EXIT; \
		(cd backend && pnpm dev) & \
		(cd frontend && VITE_API_PROXY_TARGET=http://localhost:3002 npx vite --port 7175) & \
		wait'

# ─── Database ──────────────────────────────────────────────────────────────────
DB_CONTAINER := ss-prod-db
DB_NAME      := silversea
DB_USER      := postgres

migrate: db-backup ## Run database migrations (drizzle-kit) — backs up first, fails closed
	cd backend && npx drizzle-kit migrate

# Drop and recreate the database from scratch (dev/staging — loses all data).
db-recreate:
	@echo "Recreating database $(DB_NAME) from scratch..."
	@docker exec $(DB_CONTAINER) psql -U $(DB_USER) -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='$(DB_NAME)' AND pid <> pg_backend_pid();" >/dev/null 2>&1
	@docker exec $(DB_CONTAINER) psql -U $(DB_USER) -d postgres -c "DROP DATABASE IF EXISTS $(DB_NAME);" >/dev/null 2>&1
	@docker exec $(DB_CONTAINER) psql -U $(DB_USER) -d postgres -c "CREATE DATABASE $(DB_NAME);" >/dev/null 2>&1
	@echo "✅ Database recreated"

# Generate must be serialized: two concurrent drizzle-kit generates double-claim the
# next journal idx (2026-08-29 journal-branching incident). Portable mkdir lock —
# flock does not exist on macOS (the deploy flock runs server-side on Linux only).
GENERATE_LOCK := backend/.drizzle-generate.lock.d

generate: ## Generate migration from schema changes (serialized via lock)
	@mkdir $(GENERATE_LOCK) 2>/dev/null || { echo "❌ another 'make generate' appears to be running ($(GENERATE_LOCK) exists). Generate MUST be serialized — remove the lock only if you are certain none is running." >&2; exit 1; }; \
	trap 'rmdir $(GENERATE_LOCK) 2>/dev/null' EXIT; \
	(cd backend && npx drizzle-kit generate)

db-backup: ## Timestamped pg_dump to backups/ (required before any migration apply)
	@mkdir -p backups
	@backup="backups/db-$$(date +%Y%m%d-%H%M%S).dump"; \
	docker exec $(DB_CONTAINER) pg_dump -U $(DB_USER) -Fc $(DB_NAME) > "$$backup"; \
	status=$$?; size=$$(wc -c < "$$backup" | tr -d ' '); \
	if [ $$status -ne 0 ] || [ "$$size" -lt 1024 ]; then \
		echo "❌ db-backup failed (pg_dump exit $$status, $$size bytes) — aborting. File kept for inspection: $$backup" >&2; \
		exit 1; \
	fi; \
	echo "✅ DB backup: $$backup ($$size bytes)"

# Schema-drift guard: asserts generate is a no-op on a committed-clean drizzle/ tree.
# Refuses to run on a dirty tree (would conflate real pending work with drift, and the
# cleanup must never destroy uncommitted work). If drift is found: restores tracked
# files and removes ONLY the untracked files the probe just created under
# backend/drizzle — the pre-check guarantees the tree was clean, so every ?? entry
# there is a probe artifact.
db-drift-check: ## Assert drizzle-kit generate is a no-op on a clean tree
	@if [ -n "$$(git status --porcelain backend/drizzle)" ]; then \
		echo "❌ backend/drizzle has uncommitted/untracked changes — commit or stash first; refusing to probe." >&2; \
		exit 1; \
	fi
	@cd backend && npx drizzle-kit generate --name drift-probe >/dev/null 2>&1 || true
	@if [ -n "$$(git status --porcelain backend/drizzle)" ]; then \
		echo "❌ SCHEMA DRIFT: generate produced changes on a clean tree — a schema edit has no migration." >&2; \
		echo "   Restoring tracked files; removing probe artifacts under backend/drizzle..."; \
		git checkout -- backend/drizzle; \
		git status --porcelain backend/drizzle | awk '$$1 == "??" {print $$2}' | xargs rm -f; \
		if [ -n "$$(git status --porcelain backend/drizzle)" ]; then \
			echo "   ⚠️  probe cleanup left residue — inspect backend/drizzle manually." >&2; \
		fi; \
		exit 1; \
	fi
	@echo "✅ No drift: drizzle-kit generate is a no-op on the clean tree"

# Pull a remote DB (staging or prod) into the local dev DB. Read-only against
# the remote: the remote postgres is discovered from the running container's
# env (creds differ from repo compose — never hardcode them) and the dump
# streams through the laptop so nothing is staged on the server. Local dev data
# is destroyed: dev DBs are disposable (see memory: no-backup-local-dev).
devdb: ## Sync staging DB (vantai.tingting.vip) → local dev DB — REPLACES local dev data
	@$(MAKE) --no-print-directory devdb-sync DEVDB_LABEL=staging DEVDB_SERVER=$(DEMO_SERVER) DEVDB_PATH=$(DEMO_PATH) DEVDB_COMPOSE="$(DEMO_COMPOSE)"

devdb-prod: ## Sync prod DB (silversea.tingting.vip) → local dev DB — REPLACES local dev data
	@$(MAKE) --no-print-directory devdb-sync DEVDB_LABEL=prod DEVDB_SERVER=$(PROD_SERVER) DEVDB_PATH=$(PROD_PATH) DEVDB_COMPOSE="$(PROD_COMPOSE)"

# Internal worker for devdb / devdb-prod (params via DEVDB_* variable overrides).
devdb-sync:
	@test -n "$$(docker ps -q -f name=^ss-prod-db$$)" || { echo "❌ Local DB container 'ss-prod-db' is not running — run 'make dev' first (db only: docker compose -f docker-compose.dev.yml up -d db)." >&2; exit 1; }
	@mkdir -p backups
	@dump="backups/$(DEVDB_LABEL)-devdb-$$(date +%Y%m%d-%H%M%S).dump"; \
	echo "1/3  Dumping $(DEVDB_LABEL) DB on $(DEVDB_SERVER)..."; \
	ssh root@$(DEVDB_SERVER) "set -eu; cd $(DEVDB_PATH); pg_container=\$$($(DEVDB_COMPOSE) ps -q postgres); test -n \"\$$pg_container\" || { echo 'No postgres container running on $(DEVDB_LABEL)' >&2; exit 1; }; pg_env_of() { docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' \"\$$1\"; }; pg_user=\$$(pg_env_of \"\$$pg_container\" | sed -n 's/^POSTGRES_USER=//p' | head -1); pg_db=\$$(pg_env_of \"\$$pg_container\" | sed -n 's/^POSTGRES_DB=//p' | head -1); pg_user=\$${pg_user:-postgres}; pg_db=\$${pg_db:-\$$pg_user}; echo \"     $(DEVDB_LABEL): user=\$$pg_user db=\$$pg_db\" >&2; docker exec \"\$$pg_container\" pg_dump -U \"\$$pg_user\" -Fc \"\$$pg_db\"" > "$$dump"; \
	status=$$?; size=$$(wc -c < "$$dump" | tr -d ' '); \
	if [ $$status -ne 0 ] || [ "$$size" -lt 1024 ]; then \
		echo "❌ $(DEVDB_LABEL) dump failed (exit $$status, $$size bytes) — aborting, local DB untouched. Kept for inspection: $$dump" >&2; \
		exit 1; \
	fi; \
	echo "     ✅ Dump: $$dump ($$size bytes)"; \
	echo "2/3  Restoring into local $(DB_NAME) (replaces local dev data)..."; \
	docker exec $(DB_CONTAINER) psql -U $(DB_USER) -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='$(DB_NAME)' AND pid <> pg_backend_pid();" >/dev/null 2>&1 || true; \
	docker exec $(DB_CONTAINER) psql -U $(DB_USER) -d postgres -q -c "DROP DATABASE IF EXISTS $(DB_NAME);" && \
	docker exec $(DB_CONTAINER) psql -U $(DB_USER) -d postgres -q -c "CREATE DATABASE $(DB_NAME);" && \
	docker exec -i $(DB_CONTAINER) pg_restore -U $(DB_USER) -d $(DB_NAME) --no-owner --no-privileges --exit-on-error < "$$dump"; \
	echo "3/3  Post-restore sanity:"; \
	docker exec $(DB_CONTAINER) psql -U $(DB_USER) -d $(DB_NAME) -tAc "SELECT '     tables=' || count(*) FROM information_schema.tables WHERE table_schema='public';"; \
	docker exec $(DB_CONTAINER) psql -U $(DB_USER) -d $(DB_NAME) -tAc "SELECT '     users=' || count(*) FROM users;" 2>/dev/null || true; \
	echo "✅ Local dev DB now mirrors $(DEVDB_LABEL) ($(DEVDB_SERVER)). Dump kept: $$dump"

# Sync prod DB → staging DB. Staging backend/frontend stop first (no
# mid-restore writes), staging gets a server-side backup, then public+drizzle
# schemas drop and the prod dump streams in through the laptop. Login
# credentials on staging become prod's after this (the users table comes
# over). Pair with `make demo` when the code also needs to advance.
stgdb: ## Sync prod DB (silversea.tingting.vip) → staging DB (vantai) — REPLACES staging data
	@set -eu; \
	echo "1/5  Dumping prod DB ($(PROD_SERVER))..."; \
	dump="/tmp/silversea-stgdb-$$(date -u +%Y%m%dT%H%M%SZ).dump"; \
	ssh root@$(PROD_SERVER) "set -eu; cd $(PROD_PATH); pg_container=\$$($(PROD_COMPOSE) ps -q postgres); test -n \"\$$pg_container\" || { echo 'No postgres container on prod' >&2; exit 1; }; pg_env_of() { docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' \"\$$1\"; }; pg_user=\$$(pg_env_of \"\$$pg_container\" | sed -n 's/^POSTGRES_USER=//p' | head -1); pg_db=\$$(pg_env_of \"\$$pg_container\" | sed -n 's/^POSTGRES_DB=//p' | head -1); docker exec \"\$$pg_container\" pg_dump -U \"\$${pg_user:-postgres}\" -Fc \"\$${pg_db:-\$$pg_user}\"" > "$$dump"; \
	size=$$(wc -c < "$$dump" | tr -d ' '); \
	if [ "$$size" -lt 1024 ]; then echo "❌ prod dump suspiciously small ($$size bytes) — aborting, staging untouched" >&2; exit 1; fi; \
	echo "     ✅ prod dump: $$dump ($$size bytes)"; \
	echo "2/5  Stopping staging backend/frontend..."; \
	ssh root@$(DEMO_SERVER) "cd $(DEMO_PATH) && $(DEMO_COMPOSE) stop backend frontend" >/dev/null; \
	echo "3/5  Backing up staging DB..."; \
	ssh root@$(DEMO_SERVER) "set -eu; cd $(DEMO_PATH); mkdir -p .db-backups; pg_container=\$$($(DEMO_COMPOSE) ps -q postgres); test -n \"\$$pg_container\" || { echo 'No postgres container on staging' >&2; exit 1; }; pg_env_of() { docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' \"\$$1\"; }; pg_user=\$$(pg_env_of \"\$$pg_container\" | sed -n 's/^POSTGRES_USER=//p' | head -1); pg_db=\$$(pg_env_of \"\$$pg_container\" | sed -n 's/^POSTGRES_DB=//p' | head -1); pg_user=\$${pg_user:-postgres}; pg_db=\$${pg_db:-\$$pg_user}; backup=\".db-backups/db-pre-stgdb-\$$(date -u +%Y%m%dT%H%M%SZ).dump\"; docker exec \"\$$pg_container\" pg_dump -U \"\$$pg_user\" -Fc \"\$$pg_db\" > \"\$$backup\"; size=\$$(wc -c < \"\$$backup\" | tr -d ' '); if [ \"\$$size\" -lt 1024 ]; then echo 'staging backup suspiciously small' >&2; exit 1; fi; echo \"     ✅ staging backup: \$$backup (\$$size bytes)\""; \
	echo "4/5  Dropping staging schemas + restoring prod dump (stdin)..."; \
	ssh root@$(DEMO_SERVER) "set -eu; cd $(DEMO_PATH); pg_container=\$$($(DEMO_COMPOSE) ps -q postgres); pg_env_of() { docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' \"\$$1\"; }; pg_user=\$$(pg_env_of \"\$$pg_container\" | sed -n 's/^POSTGRES_USER=//p' | head -1); pg_db=\$$(pg_env_of \"\$$pg_container\" | sed -n 's/^POSTGRES_DB=//p' | head -1); docker exec -i \"\$$pg_container\" psql -U \"\$$pg_user\" -d \"\$$pg_db\" -q -c 'DROP SCHEMA public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;'" >/dev/null; \
	ssh root@$(DEMO_SERVER) "set -eu; cd $(DEMO_PATH); pg_container=\$$($(DEMO_COMPOSE) ps -q postgres); pg_env_of() { docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' \"\$$1\"; }; pg_user=\$$(pg_env_of \"\$$pg_container\" | sed -n 's/^POSTGRES_USER=//p' | head -1); pg_db=\$$(pg_env_of \"\$$pg_container\" | sed -n 's/^POSTGRES_DB=//p' | head -1); docker exec -i \"\$$pg_container\" pg_restore -U \"\$$pg_user\" -d \"\$$pg_db\" --no-owner --no-privileges --exit-on-error" < "$$dump"; \
	echo "5/5  Restarting staging backend/frontend + sanity check..."; \
	ssh root@$(DEMO_SERVER) "set -eu; cd $(DEMO_PATH); $(DEMO_COMPOSE) up -d backend frontend >/dev/null; pg_container=\$$($(DEMO_COMPOSE) ps -q postgres); pg_env_of() { docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' \"\$$1\"; }; pg_user=\$$(pg_env_of \"\$$pg_container\" | sed -n 's/^POSTGRES_USER=//p' | head -1); pg_db=\$$(pg_env_of \"\$$pg_container\" | sed -n 's/^POSTGRES_DB=//p' | head -1); docker exec \"\$$pg_container\" psql -U \"\$$pg_user\" -d \"\$$pg_db\" -tAc \"SELECT '     tables=' || count(*) FROM pg_tables WHERE schemaname='public'\"; docker exec \"\$$pg_container\" psql -U \"\$$pg_user\" -d \"\$$pg_db\" -tAc \"SELECT '     routes=' || count(*) FROM routes WHERE deleted_at IS NULL\""; \
	rm -f "$$dump"; \
	echo "✅ Staging DB now mirrors prod ($(PROD_SERVER) → $(DEMO_SERVER)). Restart with 'make demo' to advance code too."; \
	echo "📌 Staging checklist (D4): after 'make demo' applies migration 0064+, run the DEMO freight-pricing seed — cd backend && npx tsx src/seed/seed-demo-freight-pricing.ts (staging/dev only; prod never receives invented contract data)"

setup: ## First-time setup: start infra, recreate DB, migrate, seed
	@docker compose -f docker-compose.dev.yml up -d --wait 2>/dev/null || \
		docker-compose -f docker-compose.dev.yml up -d
	@sleep 2
	@$(MAKE) db-recreate
	@# db-backup gate would abort here: a freshly recreated DB dumps <1KB.
	@# Nothing to back up on a fresh recreate — migrate without the backup hook.
	@cd backend && npx drizzle-kit migrate
	@echo "Seeding database..."
	@cd backend && pnpm seed
	@echo ""
	@echo "Setup complete! Run 'make dev' to start the app."
	@echo "  Frontend: http://localhost:7175"
	@echo "  Backend:  http://localhost:3002/api/health"

# ─── Build ─────────────────────────────────────────────────────────────────────
build: ## Build shared + backend + frontend
	pnpm --dir shared build
	pnpm --dir backend build
	pnpm --dir frontend build

# ─── Teardown ──────────────────────────────────────────────────────────────────
stop: ## Stop backend/frontend (keep db/redis)
	@echo "Stopping app processes..."
	@pkill -f "tsx watch src/index.ts" 2>/dev/null || true
	@pkill -f "vite.*7175" 2>/dev/null || true

down: ## Stop everything including db and redis
	@docker compose -f docker-compose.dev.yml down 2>/dev/null || \
		docker-compose -f docker-compose.dev.yml down

# ─── Demo deploy (vantai.tingting.vip) ─────────────────────────────────────────
# Deploys the current working tree to the demo server. The demo stack already
# runs at /opt/vantai with its own postgres (persisted at /opt/vantai/data/
# postgres) — this target only rebuilds + restarts the backend and frontend
# containers and applies pending Drizzle migrations on top of the existing DB.
# It never touches the database volume, so existing data is preserved.
#
# Flow:  build+push images → pull on server → recreate backend/frontend only →
#        drizzle-kit migrate (additive, on top of live DB) → public backend +
#        frontend checks.
#
# No backup or rollback snapshot files are created on the staging server
# (user ruling 2026-09-14): staging data is disposable, and backup files
# filled the droplet disk. The prod `deploy` target keeps its own backups.
#
# Prereqs: gh CLI authenticated with the `write:packages` scope
# (gh auth refresh -h github.com -s write:packages), and SSH access to
# root@vantai.tingting.vip.

DEMO_SERVER := vantai.tingting.vip
DEMO_PATH   := /opt/vantai
DEMO_COMPOSE := docker compose -f deploy/docker-compose.prod.yml

# Build label stamped into the backend containers at cutover (BUILD_HASH env →
# /api/health buildHash) so a staging/prod that lagged behind is diagnosable
# from one curl. Same short-sha family the GHCR secondary tags use.
DEPLOY_BUILD_HASH := $(shell git rev-parse --short HEAD 2>/dev/null || echo dev)

demo: ## Deploy the current tree to staging (vantai.tingting.vip) — keeps existing DB
	@echo "=== Deploying to $(DEMO_SERVER) ==="
	@echo "1/4  Building + pushing :latest images..."
	@$(MAKE) --no-print-directory -C backend push
	@$(MAKE) --no-print-directory -C frontend push
	@echo "2/4  Image pull on $(DEMO_SERVER) (DB volume untouched)..."
	@ssh root@$(DEMO_SERVER) "cd $(DEMO_PATH) && $(DEMO_COMPOSE) pull backend frontend"
	@echo "3/4  Migrate + catalogs + cutover..."
	@ssh root@$(DEMO_SERVER) "cd $(DEMO_PATH) && flock -w 900 .deploy-migrate.lock $(DEMO_COMPOSE) run --rm --no-deps backend npx drizzle-kit migrate"
	@ssh root@$(DEMO_SERVER) "cd $(DEMO_PATH) && flock -w 900 .deploy-migrate.lock $(DEMO_COMPOSE) run --rm --no-deps backend node dist/seed/seed-cut-catalogs.js"
	@ssh root@$(DEMO_SERVER) "cd $(DEMO_PATH) && $(DEMO_COMPOSE) rm -sf backend frontend || true"
	@ssh root@$(DEMO_SERVER) "cd $(DEMO_PATH) && BUILD_HASH=$(DEPLOY_BUILD_HASH) $(DEMO_COMPOSE) up -d --no-deps backend frontend"
	@echo "  Frontend stale-asset guard (04:43 lesson)..."
	@ssh root@$(DEMO_SERVER) "set -eu; cd $(DEMO_PATH); fr_container=\$$($(DEMO_COMPOSE) ps -q frontend); test -n \"\$$fr_container\" || { echo 'No frontend container after cutover' >&2; exit 1; }; docker exec -i \"\$$fr_container\" sh" < scripts/frontend-asset-guard.sh
	@echo "4/4  Public health checks..."
	@echo "  Backend: https://$(DEMO_SERVER)/api/health"
	@for i in $$(seq 1 12); do \
		resp=$$(curl -fsS --max-time 10 https://$(DEMO_SERVER)/api/health 2>/dev/null) && { echo "    $$resp"; break; }; \
		[ $$i -eq 12 ] && { echo "    ⚠️  backend health failed after 12 attempts — logs: ssh root@$(DEMO_SERVER) 'cd $(DEMO_PATH) && $(DEMO_COMPOSE) logs --tail=80 backend'" >&2; exit 1; }; \
		echo "    waiting ($$i/12)..."; sleep 5; \
	done
	@echo "  Frontend: https://$(DEMO_SERVER)/"
	@for i in $$(seq 1 12); do \
		curl -fsS --max-time 10 -o /dev/null https://$(DEMO_SERVER)/ && { echo "    public HTTP check passed"; break; }; \
		[ $$i -eq 12 ] && { echo "    ⚠️  frontend HTTP check failed after 12 attempts — logs: ssh root@$(DEMO_SERVER) 'cd $(DEMO_PATH) && $(DEMO_COMPOSE) logs --tail=80 frontend'" >&2; exit 1; }; \
		echo "    waiting ($$i/12)..."; sleep 5; \
	done
	@echo ""
	@echo "✅ Demo deployed: https://$(DEMO_SERVER)"

# ─── Prod deploy (silversea.tingting.vip) ─────────────────────────────────────
# `make deploy` ships the `prod` branch AS-IS (no auto fast-forward): advance
# prod deliberately (`make deploy-advance` from any branch), then run deploy
# ON the prod branch — it refuses to run elsewhere or on a dirty tree, and
# builds :prod images straight from that checkout (a separate channel from
# demo's :latest, so neither flow can clobber the other's pull target).
#
# Prereqs: one-time `make deploy-server-setup` (docker, nginx, certbot SSL,
# /opt/silversea stack files); SSH access to root@silversea.tingting.vip;
# GHCR push auth (same as `make demo`).

PROD_SERVER   := silversea.tingting.vip
PROD_PATH     := /opt/silversea
PROD_COMPOSE  := docker compose -f deploy/docker-compose.silversea.yml
PROD_BRANCH   := prod

deploy-advance: ## Fast-forward prod branch to origin/main (run from any branch; creates prod if missing)
	@git fetch origin
	@if [ "$$(git rev-parse --abbrev-ref HEAD)" = "$(PROD_BRANCH)" ]; then \
		git merge --ff-only origin/main; \
	else \
		git fetch . origin/main:$(PROD_BRANCH); \
	fi
	@echo "$(PROD_BRANCH) advanced to $$(git rev-parse --short $(PROD_BRANCH))"

deploy-db-backup: ## Server-side pg_dump of the prod DB (fails on failure) — run before manual prod data changes
	bash deploy/silversea-server-db-backup.sh

deploy-server-setup: ## One-time prod server provisioning (docker, TLS+certbot, hardening, stack files)
	bash deploy/setup-silversea-server.sh

deploy-seed: ## Run the prod master-data seed on the server (idempotent upserts; node dist/seed/seed-prod.js)
	@ssh root@$(PROD_SERVER) "cd $(PROD_PATH) && $(PROD_COMPOSE) run --rm --no-deps backend node dist/seed/seed-prod.js"

deploy: ## Deploy prod (silversea.tingting.vip) — run from the prod branch; ships it AS-IS, keeps DB
	@if [ "$$(git rev-parse --abbrev-ref HEAD)" != "$(PROD_BRANCH)" ]; then \
		echo "❌ make deploy must run ON the $(PROD_BRANCH) branch (you are on '$$(git rev-parse --abbrev-ref HEAD)')." >&2; \
		echo "    git checkout $(PROD_BRANCH) && git merge --ff-only origin/main   (or: make deploy-advance)" >&2; \
		exit 1; \
	fi
	@if [ -n "$$(git status --porcelain)" ]; then \
		echo "❌ working tree is dirty — refusing to build prod images from uncommitted changes." >&2; \
		exit 1; \
	fi
	@echo "=== Deploying prod @ $$(git rev-parse --short HEAD) to $(PROD_SERVER) (AS-IS; DB preserved) ==="
	@echo "1/4  Building + pushing :prod images from this $(PROD_BRANCH) checkout..."
	@$(MAKE) --no-print-directory -C backend push IMAGE_TAG=prod
	@$(MAKE) --no-print-directory -C frontend push IMAGE_TAG=prod
	@echo "2/4  Rollback capture + image pull on $(PROD_SERVER) (DB volume untouched)..."
	@ssh root@$(PROD_SERVER) "set -eu; cd $(PROD_PATH); rollback_dir=.deploy-rollbacks; mkdir -p \"\$$rollback_dir\"; backend_container=\$$($(PROD_COMPOSE) ps -q backend); frontend_container=\$$($(PROD_COMPOSE) ps -q frontend); if [ -z \"\$$backend_container\" ] && [ -z \"\$$frontend_container\" ]; then echo 'First deploy — no running backend/frontend to capture.'; exit 0; fi; test -n \"\$$backend_container\" || { echo 'Only frontend running; refusing partial rollback capture.' >&2; exit 1; }; test -n \"\$$frontend_container\" || { echo 'Only backend running; refusing partial rollback capture.' >&2; exit 1; }; backend_image_id=\$$(docker inspect --format='{{.Image}}' \"\$$backend_container\"); frontend_image_id=\$$(docker inspect --format='{{.Image}}' \"\$$frontend_container\"); backend_digest=\$$(docker image inspect --format='{{if .RepoDigests}}{{index .RepoDigests 0}}{{end}}' \"\$$backend_image_id\"); frontend_digest=\$$(docker image inspect --format='{{if .RepoDigests}}{{index .RepoDigests 0}}{{end}}' \"\$$frontend_image_id\"); snapshot=\"\$$rollback_dir/pre-cutover-\$$(date -u +%Y%m%dT%H%M%SZ).env\"; { printf 'BACKEND_IMAGE_ID=%s\\n' \"\$$backend_image_id\"; printf 'BACKEND_REPO_DIGEST=%s\\n' \"\$$backend_digest\"; printf 'FRONTEND_IMAGE_ID=%s\\n' \"\$$frontend_image_id\"; printf 'FRONTEND_REPO_DIGEST=%s\\n' \"\$$frontend_digest\"; } > \"\$$snapshot\"; ln -sfn \"\$$(basename \"\$$snapshot\")\" \"\$$rollback_dir/latest\"; echo \"Rollback snapshot retained: $(PROD_PATH)/\$$snapshot\"; cat \"\$$snapshot\""
	@ssh root@$(PROD_SERVER) "cd $(PROD_PATH) && $(PROD_COMPOSE) pull backend frontend"
	@echo "3/4  Server DB backup + migrate + cutover..."
	@bash deploy/silversea-server-db-backup.sh
	@ssh root@$(PROD_SERVER) "cd $(PROD_PATH) && flock -w 900 .deploy-migrate.lock $(PROD_COMPOSE) run --rm --no-deps backend npx drizzle-kit migrate"
	@ssh root@$(PROD_SERVER) "cd $(PROD_PATH) && $(PROD_COMPOSE) rm -sf backend frontend || true"
	@ssh root@$(PROD_SERVER) "cd $(PROD_PATH) && BUILD_HASH=$(DEPLOY_BUILD_HASH) $(PROD_COMPOSE) up -d --no-deps backend frontend"
	@echo "  Frontend stale-asset guard (04:43 lesson)..."
	@ssh root@$(PROD_SERVER) "set -eu; cd $(PROD_PATH); fr_container=\$$($(PROD_COMPOSE) ps -q frontend); test -n \"\$$fr_container\" || { echo 'No frontend container after cutover' >&2; exit 1; }; docker exec -i \"\$$fr_container\" sh" < scripts/frontend-asset-guard.sh
	@echo "4/4  Public health checks..."
	@echo "  Backend: https://$(PROD_SERVER)/api/health"
	@for i in $$(seq 1 12); do \
		resp=$$(curl -fsS --max-time 10 https://$(PROD_SERVER)/api/health 2>/dev/null) && { echo "    $$resp"; break; }; \
		[ $$i -eq 12 ] && { echo "    ⚠️  backend health failed after 12 attempts — logs: ssh root@$(PROD_SERVER) 'cd $(PROD_PATH) && $(PROD_COMPOSE) logs --tail=80 backend'" >&2; exit 1; }; \
		echo "    waiting ($$i/12)..."; sleep 5; \
	done
	@echo "  Frontend: https://$(PROD_SERVER)/"
	@for i in $$(seq 1 12); do \
		curl -fsS --max-time 10 -o /dev/null https://$(PROD_SERVER)/ && { echo "    public HTTP check passed"; break; }; \
		[ $$i -eq 12 ] && { echo "    ⚠️  frontend HTTP check failed after 12 attempts — logs: ssh root@$(PROD_SERVER) 'cd $(PROD_PATH) && $(PROD_COMPOSE) logs --tail=80 frontend'" >&2; exit 1; }; \
		echo "    waiting ($$i/12)..."; sleep 5; \
	done
	@echo ""
	@echo "✅ Prod deployed: https://$(PROD_SERVER)"

# ─── Help ──────────────────────────────────────────────────────────────────────
help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'
	@echo ""
	@echo "silversea dev ports:"
	@echo "  Frontend 7175  ·  Backend 3002  ·  Postgres 5441  ·  Redis 6391  ·  Adminer 8083"
	@echo ""
	@echo "demo:  make demo  →  https://vantai.tingting.vip  (DB preserved)"
	@echo "prod:  make deploy  →  https://silversea.tingting.vip  (ships the prod branch AS-IS, DB preserved)"

.DEFAULT_GOAL := help
