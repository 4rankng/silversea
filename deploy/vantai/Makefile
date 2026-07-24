# ──────────────────────────────────────────────────────────────────────────────
# TingTing — Deploy to vantai.tingting.vip (demo server)
#
# Usage:
#   make deploy             Deploy both backend + frontend
#   make deploy-backend     Deploy backend only (+ migrations)
#   make deploy-frontend    Deploy frontend only
#   make adminer-on         Enable Adminer DB GUI
#   make adminer-off        Disable Adminer
#   make prune              Remove unused Docker images
#
# Prerequisites:
#   - Images already pushed: cd backend && make push && cd ../frontend && make push
#   - SSH access to root@vantai.tingting.vip
# ──────────────────────────────────────────────────────────────────────────────

PROD_SERVER := vantai.tingting.vip
DEPLOY_PATH := /opt/vantai
COMPOSE     := docker compose -f deploy/docker-compose.prod.yml

.PHONY: deploy deploy-backend deploy-frontend adminer-on adminer-off prune

## deploy: Deploy both backend and frontend
deploy: deploy-backend deploy-frontend

## deploy-backend: Pull latest backend image, restart, run migrations
deploy-backend:
	@echo "=== Deploying backend to $(PROD_SERVER) ==="
	ssh root@$(PROD_SERVER) "cd $(DEPLOY_PATH) && $(COMPOSE) pull backend"
	ssh root@$(PROD_SERVER) "cd $(DEPLOY_PATH) && $(COMPOSE) up -d --force-recreate --no-deps backend"
	@echo "Running migrations..."
	ssh root@$(PROD_SERVER) "cd $(DEPLOY_PATH) && $(COMPOSE) exec -T backend npx drizzle-kit migrate"
	ssh root@$(PROD_SERVER) "docker image prune -f"
	@echo "Backend deployed ✓"

## deploy-frontend: Pull latest frontend image and restart
deploy-frontend:
	@echo "=== Deploying frontend to $(PROD_SERVER) ==="
	ssh root@$(PROD_SERVER) "cd $(DEPLOY_PATH) && $(COMPOSE) pull frontend"
	ssh root@$(PROD_SERVER) "cd $(DEPLOY_PATH) && $(COMPOSE) up -d --force-recreate --no-deps frontend"
	ssh root@$(PROD_SERVER) "docker image prune -f"
	@echo "Frontend deployed ✓"

## adminer-on: Enable Adminer DB GUI
adminer-on:
	ssh root@$(PROD_SERVER) "cd $(DEPLOY_PATH) && $(COMPOSE) --profile adminer up -d adminer"
	@echo "Adminer: https://$(PROD_SERVER)/adminer/"

## adminer-off: Disable Adminer
adminer-off:
	ssh root@$(PROD_SERVER) "cd $(DEPLOY_PATH) && $(COMPOSE) --profile adminer stop adminer"
	@echo "Adminer disabled"

## prune: Remove unused Docker images
prune:
	ssh root@$(PROD_SERVER) "docker image prune -f"
