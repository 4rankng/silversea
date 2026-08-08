.PHONY: push build-local

IMAGE_NAME  := ghcr.io/4rankng/transting-frontend
SOURCE_TAG  := $(shell cd .. && node scripts/release-source-tag.mjs)
BUILDER     := bb
PLATFORM    := linux/amd64

## push: Build & push frontend image to GHCR
push:
	@docker buildx inspect $(BUILDER) >/dev/null 2>&1 || docker buildx create --name $(BUILDER) --driver docker-container --use
	@docker buildx use $(BUILDER)
	@docker buildx inspect --bootstrap >/dev/null
	@echo "Checking GHCR auth..."
	@(docker info 2>/dev/null | grep -q "Username: 4rankng") || (echo "Need login..." && gh auth token | docker login ghcr.io -u 4rankng --password-stdin)
	@echo "Building & pushing $(PLATFORM) image (with inline cache)..."
	cd .. && docker buildx build \
		--platform $(PLATFORM) \
		--tag $(IMAGE_NAME):latest \
		--tag $(IMAGE_NAME):$(SOURCE_TAG) \
		--cache-from type=registry,ref=$(IMAGE_NAME):latest \
		--cache-to type=inline,mode=max \
		--build-arg BUILDKIT_INLINE_CACHE=1 \
		--provenance=false \
		--push \
		-f frontend/Dockerfile \
		.
	@echo "Push complete: $(IMAGE_NAME):latest ($(SOURCE_TAG))"

## build-local: Fast local build (native platform, no push)
build-local:
	@echo "Building locally (native platform)..."
	cd .. && docker build \
		--tag $(IMAGE_NAME):local \
		-f frontend/Dockerfile \
		.
	@echo "Local build complete: $(IMAGE_NAME):local"