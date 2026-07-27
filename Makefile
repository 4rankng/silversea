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
		(cd backend && npx tsx watch src/index.ts) & \
		(cd frontend && npx vite --port 7174) & \
		wait'

# ─── Infrastructure only ──────────────────────────────────────────────────────
infra: ## Start only db and redis (+ adminer)
	@docker compose -f docker-compose.dev.yml up -d --wait 2>/dev/null || \
		docker-compose -f docker-compose.dev.yml up -d

# ─── Database ──────────────────────────────────────────────────────────────────
migrate: ## Run database migrations
	cd backend && npx drizzle-kit migrate

generate: ## Generate migration from schema changes
	cd backend && npx drizzle-kit generate

seed: ## Seed database with sample data
	cd backend && npx tsx src/seed.ts

setup: infra ## First-time setup: infra + migrate + seed
	@sleep 2
	@echo "Applying migrations..."
	@cd backend && npx drizzle-kit migrate
	@echo "Seeding database..."
	@cd backend && npx tsx src/seed.ts
	@echo ""
	@echo "Setup complete! Run 'make dev' to start the app."
	@echo "  Frontend: http://localhost:7174"
	@echo "  Backend:  http://localhost:3001/api/health"

# ─── Studio (Drizzle ORM GUI) ─────────────────────────────────────────────────
studio: ## Open Drizzle Studio
	cd backend && npx drizzle-kit studio

# ─── Build ─────────────────────────────────────────────────────────────────────
build: ## Build shared + backend + frontend
	cd shared && npx tsc
	cd backend && npx tsc
	cd frontend && npx vite build

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
# Prereqs: backend/.env with DOCKERHUB_USERNAME / DOCKERHUB_PASSWORD, and SSH
# access to root@vantai.tingting.vip.

DEMO_SERVER := vantai.tingting.vip
DEMO_PATH   := /opt/vantai
DEMO_COMPOSE := docker compose -f deploy/docker-compose.prod.yml

demo: ## Deploy silversea to demo (vantai.tingting.vip) — keeps existing DB
	@echo "=== Deploying silversea to $(DEMO_SERVER) ==="
	@echo ""
	@echo "1/3  Building + pushing images to Docker Hub..."
	@cd backend && $(MAKE) push
	@cd frontend && $(MAKE) push
	@echo ""
	@echo "2/3  Pulling + restarting services on $(DEMO_SERVER) (DB volume untouched)..."
	@ssh root@$(DEMO_SERVER) "cd $(DEMO_PATH) && $(DEMO_COMPOSE) pull backend frontend"
	@ssh root@$(DEMO_SERVER) "cd $(DEMO_PATH) && $(DEMO_COMPOSE) up -d --force-recreate --no-deps backend frontend"
	@echo "Running pending migrations on top of existing DB..."
	@ssh root@$(DEMO_SERVER) "cd $(DEMO_PATH) && $(DEMO_COMPOSE) exec -T backend npx drizzle-kit migrate"
	@ssh root@$(DEMO_SERVER) "docker image prune -f"
	@echo ""
	@echo "3/3  Health check..."
	@$(MAKE) --no-print-directory demo-health
	@echo ""
	@echo "✅ Demo deployed: https://$(DEMO_SERVER)  (login: admin / admin123)"

demo-push: ## Build + push demo images only (no server-side changes)
	@cd backend && $(MAKE) push
	@cd frontend && $(MAKE) push

demo-deploy: ## Pull + restart + migrate on the demo server (no rebuild)
	@ssh root@$(DEMO_SERVER) "cd $(DEMO_PATH) && $(DEMO_COMPOSE) pull backend frontend"
	@ssh root@$(DEMO_SERVER) "cd $(DEMO_PATH) && $(DEMO_COMPOSE) up -d --force-recreate --no-deps backend frontend"
	@ssh root@$(DEMO_SERVER) "cd $(DEMO_PATH) && $(DEMO_COMPOSE) exec -T backend npx drizzle-kit migrate"
	@ssh root@$(DEMO_SERVER) "docker image prune -f"
	@$(MAKE) --no-print-directory demo-health

demo-health: ## Hit the demo backend health endpoint
	@echo "  Backend: https://$(DEMO_SERVER)/api/health"
	@response="$$(curl -fsS --max-time 30 https://$(DEMO_SERVER)/api/health)" \
		|| { echo "    ⚠️  health check failed — check logs:" \
			&& echo "    ssh root@$(DEMO_SERVER) 'cd $(DEMO_PATH) && $(DEMO_COMPOSE) logs --tail=80 backend'" \
			&& exit 1; }; \
		printf '%s\n' "$$response" | sed 's/^/    /'

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
