# Load Docker Hub credentials
include .env
export

.PHONY: push deploy link-drivers link-drivers-apply

IMAGE_NAME  := $(DOCKERHUB_USERNAME)/transting-backend
GIT_SHA     := $(shell cd .. && git rev-parse --short HEAD)
BUILDER     := bb
PROD_SERVER := nepo.tingting.vip

## push: Build & push backend image to Docker Hub
push:
	@docker buildx inspect $(BUILDER) >/dev/null 2>&1 || docker buildx create --name $(BUILDER) --driver docker-container --use
	@docker buildx use $(BUILDER)
	@docker buildx inspect --bootstrap >/dev/null
	@echo "Logging into DockerHub..."
	@echo "$(DOCKERHUB_PASSWORD)" | docker login -u "$(DOCKERHUB_USERNAME)" --password-stdin
	@echo "Building & pushing AMD64 image (with inline cache)..."
	cd .. && docker buildx build \
		--platform linux/amd64 \
		--tag $(IMAGE_NAME):latest \
		--tag $(IMAGE_NAME):$(GIT_SHA) \
		--cache-from type=registry,ref=$(IMAGE_NAME):latest \
		--build-arg BUILDKIT_INLINE_CACHE=1 \
		--provenance=false \
		--push \
		-f backend/Dockerfile \
		.
	@echo "Push complete: $(IMAGE_NAME):latest ($(GIT_SHA))"

## deploy: Pull & restart backend on droplet + run migrations
deploy:
	@echo "Deploying backend on production..."
	@echo "Pulling latest image..."
	ssh root@$(PROD_SERVER) "cd /opt/nepocorp && docker compose -f deploy/docker-compose.prod.yml pull backend"
	@echo "Restarting backend service (new image for migrations)..."
	ssh root@$(PROD_SERVER) "cd /opt/nepocorp && docker compose -f deploy/docker-compose.prod.yml up -d --force-recreate --no-deps backend"
	@echo "Waiting for backend container to be ready..."
	@for i in 1 2 3 4 5 6 7 8 9 10; do \
		if ssh root@$(PROD_SERVER) "docker exec nepocorp-backend-1 echo ok" >/dev/null 2>&1; then \
			break; \
		fi; \
		echo "  waiting... ($$i)"; \
		sleep 2; \
	done
	@echo "Running database migrations..."
	ssh root@$(PROD_SERVER) "docker exec nepocorp-backend-1 npx drizzle-kit migrate"
	@echo "Cleaning up unused images..."
	ssh root@$(PROD_SERVER) "docker image prune -f"
	@echo "Backend deployment complete!"
	@echo "API: https://$(PROD_SERVER)/api/health"

## link-drivers: Dry-run — list orphan drivers that would link to existing users
link-drivers:
	@npx tsx scripts/link-orphan-drivers.ts

## link-drivers-apply: Link orphan driver profiles to existing matching user accounts
link-drivers-apply:
	@npx tsx scripts/link-orphan-drivers.ts --apply
