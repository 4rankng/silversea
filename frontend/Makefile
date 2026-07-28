# Load Docker Hub credentials (shared with backend)
include ../backend/.env
export

.PHONY: push deploy

IMAGE_NAME  := $(DOCKERHUB_USERNAME)/transting-frontend
SOURCE_TAG  := $(shell cd .. && node scripts/release-source-tag.mjs)
BUILDER     := bb
PROD_SERVER := nepo.tingting.vip

## push: Build & push frontend image to Docker Hub
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
		--tag $(IMAGE_NAME):$(SOURCE_TAG) \
		--cache-from type=registry,ref=$(IMAGE_NAME):latest \
		--build-arg BUILDKIT_INLINE_CACHE=1 \
		--provenance=false \
		--push \
		-f frontend/Dockerfile \
		.
	@echo "Push complete: $(IMAGE_NAME):latest ($(SOURCE_TAG))"

## deploy: Pull & restart frontend on droplet
deploy:
	@echo "Deploying frontend on production..."
	@echo "Pulling latest image..."
	ssh root@$(PROD_SERVER) "cd /opt/nepocorp && docker compose -f deploy/docker-compose.prod.yml pull frontend"
	@echo "Restarting frontend service..."
	ssh root@$(PROD_SERVER) "cd /opt/nepocorp && docker compose -f deploy/docker-compose.prod.yml up -d --force-recreate --no-deps frontend"
	@echo "Cleaning up unused images..."
	ssh root@$(PROD_SERVER) "docker image prune -f"
	@echo "Frontend deployment complete!"
	@echo "https://$(PROD_SERVER)"
