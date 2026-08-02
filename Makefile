.PHONY: dev stop down setup seed migrate generate build studio help \
        logs-db logs-redis infra demo demo-push demo-deploy demo-health

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
	@echo "Running migrations..."
	@cd backend && npx drizzle-kit migrate 2>&1 | grep -v "already exists, skipping" || true
	@echo ""
	@echo "Starting backend (port 3001) and frontend (port 7174)..."
	@echo "  Frontend: http://localhost:7174"
	@echo "  Backend:  http://localhost:3001/api/health"
	@echo "  Adminer:  http://localhost:8083  (DB: silversea · user/pass: postgres/postgres)"
	@echo "  (Ctrl-C stops backend + frontend; db/redis keep running)"
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
MIGRATION_SQL := backend/drizzle/0000_black_kingpin.sql

migrate: ## Run database migrations (drizzle-kit)
	cd backend && npx drizzle-kit migrate

# Apply the baseline migration SQL directly. Drizzle-kit's interactive spinner
# hangs on large schemas; the direct psql apply is reliable. Applied twice
# because drizzle generates FK constraints before the unique indexes they depend
# on — the first pass creates tables + indexes, the second resolves the FKs.
migrate-sql:
	@docker exec -i $(DB_CONTAINER) psql -U $(DB_USER) -d $(DB_NAME) -c "CREATE EXTENSION IF NOT EXISTS vector;" >/dev/null 2>&1
	@docker exec -i $(DB_CONTAINER) psql -U $(DB_USER) -d $(DB_NAME) -q < $(MIGRATION_SQL) >/dev/null 2>&1
	@docker exec -i $(DB_CONTAINER) psql -U $(DB_USER) -d $(DB_NAME) -q < $(MIGRATION_SQL) >/dev/null 2>&1
	@echo "✅ Migration applied (2-pass for FK ordering)"

# Drop and recreate the database from scratch (dev/staging — loses all data).
db-recreate:
	@echo "Recreating database $(DB_NAME) from scratch..."
	@docker exec $(DB_CONTAINER) psql -U $(DB_USER) -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='$(DB_NAME)' AND pid <> pg_backend_pid();" >/dev/null 2>&1
	@docker exec $(DB_CONTAINER) psql -U $(DB_USER) -d postgres -c "DROP DATABASE IF EXISTS $(DB_NAME);" >/dev/null 2>&1
	@docker exec $(DB_CONTAINER) psql -U $(DB_USER) -d postgres -c "CREATE DATABASE $(DB_NAME);" >/dev/null 2>&1
	@echo "✅ Database recreated"

generate: ## Generate migration from schema changes
	cd backend && npx drizzle-kit generate

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
# Flow:  build+push images → pull on server → recreate backend/frontend only
#        → drizzle-kit migrate (additive, on top of live DB) → health check.
#
# Prereqs: gh CLI authenticated with the `write:packages` scope
# (gh auth refresh -h github.com -s write:packages), and SSH access to
# root@vantai.tingting.vip.

DEMO_SERVER := vantai.tingting.vip
DEMO_PATH   := /opt/vantai
DEMO_COMPOSE := docker compose -f deploy/docker-compose.prod.yml

demo: ## Deploy silversea to demo (vantai.tingting.vip) — keeps existing DB
	@echo "=== Deploying silversea to $(DEMO_SERVER) ==="
	@echo ""
	@echo "1/3  Building + pushing images to GHCR..."
	@cd backend && $(MAKE) push
	@cd frontend && $(MAKE) push
	@echo ""
	@echo "2/3  Pulling, migrating, then restarting services on $(DEMO_SERVER) (DB volume untouched)..."
	@ssh root@$(DEMO_SERVER) "cd $(DEMO_PATH) && $(DEMO_COMPOSE) pull backend frontend"
	@echo "Running pending migrations with the pulled backend image before cutover..."
	@ssh root@$(DEMO_SERVER) "cd $(DEMO_PATH) && $(DEMO_COMPOSE) run --rm --no-deps backend npx drizzle-kit migrate"
	@ssh root@$(DEMO_SERVER) "cd $(DEMO_PATH) && $(DEMO_COMPOSE) up -d --force-recreate --no-deps backend frontend"
	@ssh root@$(DEMO_SERVER) "docker image prune -f"
	@echo ""
	@echo "3/3  Health check..."
	@$(MAKE) --no-print-directory demo-health
	@echo ""
	@echo "✅ Demo deployed: https://$(DEMO_SERVER)  (use approved staging credentials)"

demo-push: ## Build + push demo images only (no server-side changes)
	@cd backend && $(MAKE) push
	@cd frontend && $(MAKE) push

demo-deploy: ## Pull + restart + migrate on the demo server (no rebuild)
	@ssh root@$(DEMO_SERVER) "cd $(DEMO_PATH) && $(DEMO_COMPOSE) pull backend frontend"
	@ssh root@$(DEMO_SERVER) "cd $(DEMO_PATH) && $(DEMO_COMPOSE) run --rm --no-deps backend npx drizzle-kit migrate"
	@ssh root@$(DEMO_SERVER) "cd $(DEMO_PATH) && $(DEMO_COMPOSE) up -d --force-recreate --no-deps backend frontend"
	@ssh root@$(DEMO_SERVER) "docker image prune -f"
	@$(MAKE) --no-print-directory demo-health

demo-health: ## Hit the demo backend health endpoint
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
