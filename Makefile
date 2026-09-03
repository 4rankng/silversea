.PHONY: dev stop down setup seed migrate generate build studio help \
        logs-db logs-redis infra demo demo-push demo-deploy demo-health demo-capture-rollback \
        db-backup db-drift-check demo-db-backup

# ─── Ports (silversea — de-conflicted from nepocorp) ─────────────────────────
# PostgreSQL: 5441  |  Redis: 6391  |  Backend: 3001  |  Frontend: 7174  |  Adminer: 8083
# nepocorp uses 5440/6390/3090/7173/8081 + tingting-* containers; this stack
# runs alongside it without port or container-name collisions.

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
	@echo "Starting backend (port 3001) and frontend (port 7174)..."
	@echo "  Frontend: http://localhost:7174"
	@echo "  Backend:  http://localhost:3001/api/health"
	@echo "  Adminer:  http://localhost:8083  (DB: silversea · user/pass: postgres/postgres)"
	@echo "  (Ctrl-C stops backend + frontend; db/redis keep running)"
	@pid=$$(lsof -ti tcp:7174 -sTCP:LISTEN 2>/dev/null); \
	if [ -n "$$pid" ]; then \
		echo "Port 7174 in use (stale PID $$pid) — freeing..."; \
		kill $$pid 2>/dev/null || true; \
		sleep 1; \
		kill -9 $$pid 2>/dev/null || true; \
	fi
	@bash -c '\
		trap "kill 0" EXIT; \
		(cd backend && pnpm dev) & \
		(cd frontend && npx vite --port 7174) & \
		wait'

# ─── Infrastructure only ──────────────────────────────────────────────────────
infra: ## Start only db and redis (+ adminer)
	@docker compose -f docker-compose.dev.yml up -d --wait 2>/dev/null || \
		docker-compose -f docker-compose.dev.yml up -d

# ─── Database ──────────────────────────────────────────────────────────────────
DB_CONTAINER := silversea-db
DB_NAME      := silversea
DB_USER      := postgres

migrate: db-backup ## Run database migrations (drizzle-kit) — backs up first, fails closed
	cd backend && npx drizzle-kit migrate

# Apply the single baseline through Drizzle so the migration journal remains
# authoritative. The baseline creates its required extensions and has no
# foreign-key ordering dependency.
migrate-sql: db-backup
	@cd backend && DATABASE_URL=postgres://$(DB_USER):postgres@localhost:5441/$(DB_NAME) npx drizzle-kit migrate
	@echo "✅ Single baseline migration applied"

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
	cd backend && npx drizzle-kit generate

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

seed: ## Seed database with sample data
	cd backend && pnpm seed

setup: infra ## First-time setup: infra + recreate DB + migrate + seed
	@sleep 2
	@$(MAKE) db-recreate
	@$(MAKE) migrate-sql
	@echo "Seeding database..."
	@cd backend && pnpm seed
	@echo ""
	@echo "Setup complete! Run 'make dev' to start the app."
	@echo "  Frontend: http://localhost:7174"
	@echo "  Backend:  http://localhost:3001/api/health"

# ─── Studio (Drizzle ORM GUI) ─────────────────────────────────────────────────
studio: ## Open Drizzle Studio
	cd backend && npx drizzle-kit studio

# ─── Build ─────────────────────────────────────────────────────────────────────
build: ## Build shared + backend + frontend
	pnpm --dir shared build
	pnpm --dir backend build
	pnpm --dir frontend build

# ─── Teardown ──────────────────────────────────────────────────────────────────
stop: ## Stop backend/frontend (keep db/redis)
	@echo "Stopping app processes..."
	@pkill -f "tsx watch src/index.ts" 2>/dev/null || true
	@pkill -f "vite.*7174" 2>/dev/null || true

down: ## Stop everything including db and redis
	@docker compose -f docker-compose.dev.yml down 2>/dev/null || \
		docker-compose -f docker-compose.dev.yml down

# ─── Logs ──────────────────────────────────────────────────────────────────────
logs-db: ## Show database logs
	@docker compose -f docker-compose.dev.yml logs -f db 2>/dev/null || \
		docker-compose -f docker-compose.dev.yml logs -f db

logs-redis: ## Show redis logs
	@docker compose -f docker-compose.dev.yml logs -f redis 2>/dev/null || \
		docker-compose -f docker-compose.dev.yml logs -f redis

# ─── Demo deploy (vantai.tingting.vip) ─────────────────────────────────────────
# Deploys the current working tree to the demo server. The demo stack already
# runs at /opt/vantai with its own postgres (persisted at /opt/vantai/data/
# postgres) — this target only rebuilds + restarts the backend and frontend
# containers and applies pending Drizzle migrations on top of the existing DB.
# It never touches the database volume, so existing data is preserved.
#
# Flow:  build+push images → record the running backend/frontend images for
#        rollback → pull on server → recreate backend/frontend only → drizzle-kit
#        migrate (additive, on top of live DB) → public backend + frontend checks.
#
# Automatic image pruning is intentionally excluded: the recorded pre-cutover
# image IDs must remain available until a later, explicitly reviewed cleanup.
#
# Prereqs: gh CLI authenticated with the `write:packages` scope
# (gh auth refresh -h github.com -s write:packages), and SSH access to
# root@vantai.tingting.vip.

DEMO_SERVER := vantai.tingting.vip
DEMO_PATH   := /opt/vantai
DEMO_COMPOSE := docker compose -f deploy/docker-compose.prod.yml

demo-capture-rollback: ## Record running demo backend/frontend images before a cutover
	@ssh root@$(DEMO_SERVER) "set -eu; cd $(DEMO_PATH); rollback_dir=.deploy-rollbacks; mkdir -p \"\$$rollback_dir\"; backend_container=\$$($(DEMO_COMPOSE) ps -q backend); frontend_container=\$$($(DEMO_COMPOSE) ps -q frontend); test -n \"\$$backend_container\" || { echo 'No running backend container; refusing cutover without rollback image.' >&2; exit 1; }; test -n \"\$$frontend_container\" || { echo 'No running frontend container; refusing cutover without rollback image.' >&2; exit 1; }; backend_image_id=\$$(docker inspect --format='{{.Image}}' \"\$$backend_container\"); frontend_image_id=\$$(docker inspect --format='{{.Image}}' \"\$$frontend_container\"); backend_digest=\$$(docker image inspect --format='{{if .RepoDigests}}{{index .RepoDigests 0}}{{end}}' \"\$$backend_image_id\"); frontend_digest=\$$(docker image inspect --format='{{if .RepoDigests}}{{index .RepoDigests 0}}{{end}}' \"\$$frontend_image_id\"); snapshot=\"\$$rollback_dir/pre-cutover-\$$(date -u +%Y%m%dT%H%M%SZ).env\"; { printf 'BACKEND_IMAGE_ID=%s\\n' \"\$$backend_image_id\"; printf 'BACKEND_REPO_DIGEST=%s\\n' \"\$$backend_digest\"; printf 'FRONTEND_IMAGE_ID=%s\\n' \"\$$frontend_image_id\"; printf 'FRONTEND_REPO_DIGEST=%s\\n' \"\$$frontend_digest\"; } > \"\$$snapshot\"; ln -sfn \"\$$(basename \"\$$snapshot\")\" \"\$$rollback_dir/latest\"; echo \"Rollback snapshot retained: $(DEMO_PATH)/\$$snapshot\"; cat \"\$$snapshot\""

demo-db-backup: ## Server-side pg_dump of the demo DB before a deploy migrate (fails the deploy on failure)
	@ssh root@$(DEMO_SERVER) "set -eu; cd $(DEMO_PATH); mkdir -p .db-backups; pg_container=\$$($(DEMO_COMPOSE) ps -q postgres); test -n \"\$$pg_container\" || { echo 'No postgres container running' >&2; exit 1; }; pg_env_of() { docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' \"\$$1\"; }; pg_user=\$$(pg_env_of \"\$$pg_container\" | sed -n 's/^POSTGRES_USER=//p' | head -1); pg_db=\$$(pg_env_of \"\$$pg_container\" | sed -n 's/^POSTGRES_DB=//p' | head -1); pg_user=\$${pg_user:-postgres}; pg_db=\$${pg_db:-\$$pg_user}; backup=\".db-backups/db-\$$(date -u +%Y%m%dT%H%M%SZ).dump\"; docker exec -i \"\$$pg_container\" pg_dump -U \"\$$pg_user\" -Fc \"\$$pg_db\" > \"\$$backup\"; size=\$$(wc -c < \"\$$backup\" | tr -d ' '); if [ \"\$$size\" -lt 1024 ]; then echo \"Backup suspiciously small (\$$size bytes) — aborting deploy\" >&2; exit 1; fi; echo \"✅ Server DB backup: $(DEMO_PATH)/\$$backup (\$$size bytes) [user=\$$pg_user db=\$$pg_db]\""

demo: ## Deploy silversea to demo (vantai.tingting.vip) — keeps existing DB
	@echo "=== Deploying silversea to $(DEMO_SERVER) ==="
	@echo ""
	@echo "1/3  Building + pushing images to GHCR (with BuildKit cache)..."
	@cd backend && $(MAKE) push
	@cd frontend && $(MAKE) push
	@echo ""
	@echo "2/3  Recording rollback images, then pulling, migrating, and restarting services on $(DEMO_SERVER) (DB volume untouched)..."
	@$(MAKE) --no-print-directory demo-capture-rollback
	@ssh root@$(DEMO_SERVER) "cd $(DEMO_PATH) && $(DEMO_COMPOSE) pull backend frontend"
	@echo "Backing up the server DB before migrate..."
	@$(MAKE) --no-print-directory demo-db-backup
	@echo "Running pending migrations with the pulled backend image before cutover..."
	@ssh root@$(DEMO_SERVER) "cd $(DEMO_PATH) && flock -w 900 .deploy-migrate.lock $(DEMO_COMPOSE) run --rm --no-deps backend npx drizzle-kit migrate"
	@ssh root@$(DEMO_SERVER) "cd $(DEMO_PATH) && $(DEMO_COMPOSE) rm -sf backend frontend || true"
	@ssh root@$(DEMO_SERVER) "cd $(DEMO_PATH) && $(DEMO_COMPOSE) up -d --no-deps backend frontend"
	@echo ""
	@echo "3/3  Public backend and frontend acceptance checks..."
	@$(MAKE) --no-print-directory demo-health
	@echo ""
	@echo "✅ Demo deployed: https://$(DEMO_SERVER)  (use approved staging credentials)"

demo-push: ## Build + push demo images only (no server-side changes)
	@cd backend && $(MAKE) push
	@cd frontend && $(MAKE) push

demo-local: ## Build images locally only (fast, native platform, no push)
	@cd backend && $(MAKE) build-local
	@cd frontend && $(MAKE) build-local
	@echo ""
	@echo "✅ Local builds complete:"
	@echo "   Backend: ghcr.io/4rankng/transting-backend:local"
	@echo "   Frontend: ghcr.io/4rankng/transting-frontend:local"
	@echo ""
	@echo "Run with: docker compose -f deploy/docker-compose.prod.yml up -d backend frontend"

demo-deploy: ## Pull + restart + migrate on the demo server (no rebuild)
	@$(MAKE) --no-print-directory demo-capture-rollback
	@ssh root@$(DEMO_SERVER) "cd $(DEMO_PATH) && $(DEMO_COMPOSE) pull backend frontend"
	@$(MAKE) --no-print-directory demo-db-backup
	@ssh root@$(DEMO_SERVER) "cd $(DEMO_PATH) && flock -w 900 .deploy-migrate.lock $(DEMO_COMPOSE) run --rm --no-deps backend npx drizzle-kit migrate"
	@ssh root@$(DEMO_SERVER) "cd $(DEMO_PATH) && $(DEMO_COMPOSE) rm -sf backend frontend || true"
	@ssh root@$(DEMO_SERVER) "cd $(DEMO_PATH) && $(DEMO_COMPOSE) up -d --no-deps backend frontend"
	@$(MAKE) --no-print-directory demo-health

demo-health: ## Check public demo backend and frontend endpoints
	@echo "  Backend: https://$(DEMO_SERVER)/api/health"
	@attempt=1; \
	while [ "$$attempt" -le 12 ]; do \
		if response="$$(curl -fsS --max-time 10 https://$(DEMO_SERVER)/api/health 2>/dev/null)"; then \
			printf '%s\n' "$$response" | sed 's/^/    /'; \
			exit 0; \
		fi; \
		if [ "$$attempt" -eq 12 ]; then \
			echo "    ⚠️  health check failed after 12 attempts — check logs:"; \
			echo "    ssh root@$(DEMO_SERVER) 'cd $(DEMO_PATH) && $(DEMO_COMPOSE) logs --tail=80 backend'"; \
			exit 1; \
		fi; \
		echo "    Waiting for backend readiness ($$attempt/12)..."; \
		sleep 5; \
		attempt=$$((attempt + 1)); \
	done
	@echo "  Frontend: https://$(DEMO_SERVER)/"
	@attempt=1; \
	while [ "$$attempt" -le 12 ]; do \
		if curl -fsS --max-time 10 -o /dev/null https://$(DEMO_SERVER)/; then \
			echo "    public HTTP check passed"; \
			exit 0; \
		fi; \
		if [ "$$attempt" -eq 12 ]; then \
			echo "    ⚠️  frontend HTTP check failed after 12 attempts — check logs:"; \
			echo "    ssh root@$(DEMO_SERVER) 'cd $(DEMO_PATH) && $(DEMO_COMPOSE) logs --tail=80 frontend'"; \
			exit 1; \
		fi; \
		echo "    Waiting for frontend readiness ($$attempt/12)..."; \
		sleep 5; \
		attempt=$$((attempt + 1)); \
	done

# ─── Prod deploy (silversea.tingting.vip) ─────────────────────────────────────
# `make deploy` ships the `prod` branch AS-IS (no auto fast-forward): advance
# prod deliberately (`git branch -f prod origin/main && git push origin prod`
# from a fetched main), then deploy exactly what it points to.
#
# Images build in a dedicated clean worktree (.deploy-worktrees/prod) so the
# interactive session's dirty tree is never swept into a prod image, and are
# pushed as :prod (+ :prod-<sha>) — a separate channel from demo's :latest, so
# neither flow can clobber the other's pull target.
#
# Prereqs: one-time `make deploy-server-setup` (docker, nginx, certbot SSL,
# /opt/silversea stack files); SSH access to root@silversea.tingting.vip;
# GHCR push auth (same as `make demo`).

PROD_SERVER   := silversea.tingting.vip
PROD_PATH     := /opt/silversea
PROD_COMPOSE  := docker compose -f deploy/docker-compose.silversea.yml
PROD_BRANCH   := prod
PROD_WORKTREE := .deploy-worktrees/prod

deploy-prepare: ## Ensure prod branch + clean build worktree exist
	@git fetch origin main
	@if git show-ref --verify --quiet refs/heads/$(PROD_BRANCH); then \
		echo "$(PROD_BRANCH) @ $$(git rev-parse --short $(PROD_BRANCH)) — deploying AS-IS (no auto fast-forward; advance prod deliberately)"; \
	else \
		git branch $(PROD_BRANCH) origin/main; \
		echo "Created $(PROD_BRANCH) from origin/main @ $$(git rev-parse --short $(PROD_BRANCH))"; \
	fi
	@if git worktree list --porcelain | grep -qF "worktree $(CURDIR)/$(PROD_WORKTREE)"; then \
		git -C $(PROD_WORKTREE) checkout -q $(PROD_BRANCH); \
	else \
		git worktree add $(PROD_WORKTREE) $(PROD_BRANCH); \
	fi
	@if [ -n "$$(git -C $(PROD_WORKTREE) status --porcelain)" ]; then \
		echo "❌ $(PROD_WORKTREE) is dirty — refusing to build prod images from an unclean tree." >&2; \
		exit 1; \
	fi

deploy-push: deploy-prepare ## Build + push :prod images from the prod worktree
	@echo "Building from $(PROD_BRANCH) @ $$(git -C $(PROD_WORKTREE) rev-parse --short HEAD)"
	@$(MAKE) --no-print-directory -C $(PROD_WORKTREE)/backend push IMAGE_TAG=prod
	@$(MAKE) --no-print-directory -C $(PROD_WORKTREE)/frontend push IMAGE_TAG=prod

deploy-capture-rollback: ## Record running prod backend/frontend images before cutover
	@ssh root@$(PROD_SERVER) "set -eu; cd $(PROD_PATH); rollback_dir=.deploy-rollbacks; mkdir -p \"\$$rollback_dir\"; backend_container=\$$($(PROD_COMPOSE) ps -q backend); frontend_container=\$$($(PROD_COMPOSE) ps -q frontend); if [ -z \"\$$backend_container\" ] && [ -z \"\$$frontend_container\" ]; then echo 'First deploy — no running backend/frontend to capture.'; exit 0; fi; test -n \"\$$backend_container\" || { echo 'Only frontend running; refusing partial rollback capture.' >&2; exit 1; }; test -n \"\$$frontend_container\" || { echo 'Only backend running; refusing partial rollback capture.' >&2; exit 1; }; backend_image_id=\$$(docker inspect --format='{{.Image}}' \"\$$backend_container\"); frontend_image_id=\$$(docker inspect --format='{{.Image}}' \"\$$frontend_container\"); backend_digest=\$$(docker image inspect --format='{{if .RepoDigests}}{{index .RepoDigests 0}}{{end}}' \"\$$backend_image_id\"); frontend_digest=\$$(docker image inspect --format='{{if .RepoDigests}}{{index .RepoDigests 0}}{{end}}' \"\$$frontend_image_id\"); snapshot=\"\$$rollback_dir/pre-cutover-\$$(date -u +%Y%m%dT%H%M%SZ).env\"; { printf 'BACKEND_IMAGE_ID=%s\\n' \"\$$backend_image_id\"; printf 'BACKEND_REPO_DIGEST=%s\\n' \"\$$backend_digest\"; printf 'FRONTEND_IMAGE_ID=%s\\n' \"\$$frontend_image_id\"; printf 'FRONTEND_REPO_DIGEST=%s\\n' \"\$$frontend_digest\"; } > \"\$$snapshot\"; ln -sfn \"\$$(basename \"\$$snapshot\")\" \"\$$rollback_dir/latest\"; echo \"Rollback snapshot retained: $(PROD_PATH)/\$$snapshot\"; cat \"\$$snapshot\""

deploy-db-backup: ## Server-side pg_dump of the prod DB before the deploy migrate
	@ssh root@$(PROD_SERVER) "set -eu; cd $(PROD_PATH); mkdir -p .db-backups; pg_container=\$$($(PROD_COMPOSE) ps -q postgres); test -n \"\$$pg_container\" || { echo 'No postgres container running' >&2; exit 1; }; pg_env_of() { docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' \"\$$1\"; }; pg_user=\$$(pg_env_of \"\$$pg_container\" | sed -n 's/^POSTGRES_USER=//p' | head -1); pg_db=\$$(pg_env_of \"\$$pg_container\" | sed -n 's/^POSTGRES_DB=//p' | head -1); pg_user=$${pg_user:-postgres}; pg_db=$${pg_db:-\$$pg_user}; backup=\".db-backups/db-\$$(date -u +%Y%m%dT%H%M%SZ).dump\"; docker exec \"\$$pg_container\" pg_dump -U \"\$$pg_user\" -Fc \"\$$pg_db\" > \"\$$backup\"; status=$$?; size=$$(wc -c < \"\$$backup\" | tr -d ' '); if [ \"\$$status\" -ne 0 ] || [ \"\$$size\" -lt 1024 ]; then echo \"❌ pg_dump failed (exit \$$status, \$$size bytes) — aborting deploy; file kept: \$$backup\" >&2; exit 1; fi; echo \"✅ Prod DB backup: $(PROD_PATH)/\$$backup (\$$size bytes) [user=\$$pg_user db=\$$pg_db]\""

deploy-health: ## Check public prod backend and frontend endpoints
	@echo "  Backend: https://$(PROD_SERVER)/api/health"
	@attempt=1; \
	while [ "$$attempt" -le 12 ]; do \
		if response="$$(curl -fsS --max-time 10 https://$(PROD_SERVER)/api/health 2>/dev/null)"; then \
			printf '%s\n' "$$response" | sed 's/^/    /'; \
			exit 0; \
		fi; \
		if [ "$$attempt" -eq 12 ]; then \
			echo "    ⚠️  health check failed after 12 attempts — check logs:"; \
			echo "    ssh root@$(PROD_SERVER) 'cd $(PROD_PATH) && $(PROD_COMPOSE) logs --tail=80 backend'"; \
			exit 1; \
		fi; \
		echo "    Waiting for backend readiness ($$attempt/12)..."; \
		sleep 5; \
		attempt=$$((attempt + 1)); \
	done
	@echo "  Frontend: https://$(PROD_SERVER)/"
	@attempt=1; \
	while [ "$$attempt" -le 12; do \
		if curl -fsS --max-time 10 -o /dev/null https://$(PROD_SERVER)/; then \
			echo "    public HTTP check passed"; \
			exit 0; \
		fi; \
		if [ "$$attempt" -eq 12 ]; then \
			echo "    ⚠️  frontend HTTP check failed after 12 attempts — check logs:"; \
			echo "    ssh root@$(PROD_SERVER) 'cd $(PROD_PATH) && $(PROD_COMPOSE) logs --tail=80 frontend'"; \
			exit 1; \
		fi; \
		echo "    Waiting for frontend readiness ($$attempt/12)..."; \
		sleep 5; \
		attempt=$$((attempt + 1)); \
	done

deploy: ## Deploy prod (silversea.tingting.vip) — ships prod branch AS-IS, keeps DB
	@echo "=== Deploying prod to $(PROD_SERVER) ==="
	@echo ""
	@echo "1/3  Building + pushing :prod images from the $(PROD_BRANCH) worktree..."
	@$(MAKE) --no-print-directory deploy-push
	@echo ""
	@echo "2/3  Rollback capture → pull → DB backup → migrate → recreate backend+frontend on $(PROD_SERVER) (DB volume untouched)..."
	@$(MAKE) --no-print-directory deploy-capture-rollback
	@ssh root@$(PROD_SERVER) "cd $(PROD_PATH) && $(PROD_COMPOSE) pull backend frontend"
	@echo "Backing up the prod DB before migrate..."
	@$(MAKE) --no-print-directory deploy-db-backup
	@echo "Running pending migrations with the pulled backend image before cutover..."
	@ssh root@$(PROD_SERVER) "cd $(PROD_PATH) && flock -w 900 .deploy-migrate.lock $(PROD_COMPOSE) run --rm --no-deps backend npx drizzle-kit migrate"
	@ssh root@$(PROD_SERVER) "cd $(PROD_PATH) && $(PROD_COMPOSE) rm -sf backend frontend || true"
	@ssh root@$(PROD_SERVER) "cd $(PROD_PATH) && $(PROD_COMPOSE) up -d --no-deps backend frontend"
	@echo ""
	@echo "3/3  Public backend and frontend acceptance checks..."
	@$(MAKE) --no-print-directory deploy-health
	@echo ""
	@echo "✅ Prod deployed: https://$(PROD_SERVER)"

# ─── Help ──────────────────────────────────────────────────────────────────────
help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'
	@echo ""
	@echo "silversea dev ports (de-conflicted from nepocorp):"
	@echo "  Frontend 7174  ·  Backend 3001  ·  Postgres 5441  ·  Redis 6391  ·  Adminer 8083"
	@echo ""
	@echo "demo:  make demo  →  https://vantai.tingting.vip  (DB preserved)"

.DEFAULT_GOAL := help
