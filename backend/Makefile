.PHONY: push build-local link-drivers link-drivers-apply

IMAGE_NAME  := ghcr.io/4rankng/transting-backend
# IMAGE_TAG selects the deploy channel: `latest` = demo (vantai), `prod` = prod
# (silversea). Distinct tags keep the two flows from clobbering each other.
IMAGE_TAG   ?= latest
SOURCE_TAG  := $(shell cd .. && node scripts/release-source-tag.mjs)
# Demo keeps its historical `<sha>` secondary tag; other channels get a
# channel-prefixed one (`prod-<sha>`).
ifeq ($(IMAGE_TAG),latest)
SECONDARY_TAG := $(SOURCE_TAG)
else
SECONDARY_TAG := $(IMAGE_TAG)-$(SOURCE_TAG)
endif
BUILDER     := bb
PLATFORM    := linux/amd64

## push: Build & push backend image to GHCR (IMAGE_TAG=latest|prod)
push:
	@docker buildx inspect $(BUILDER) >/dev/null 2>&1 || docker buildx create --name $(BUILDER) --driver docker-container --use
	@docker buildx use $(BUILDER)
	@docker buildx inspect --bootstrap >/dev/null
	@echo "Checking GHCR auth..."
	@(docker info 2>/dev/null | grep -q "Username: 4rankng") || (echo "Need login..." && gh auth token | docker login ghcr.io -u 4rankng --password-stdin)
	@echo "Building & pushing $(PLATFORM) image (with inline cache)..."
	cd .. && docker buildx build \
		--platform $(PLATFORM) \
		--tag $(IMAGE_NAME):$(IMAGE_TAG) \
		--tag $(IMAGE_NAME):$(SECONDARY_TAG) \
		--cache-from type=registry,ref=$(IMAGE_NAME):$(IMAGE_TAG) \
		--cache-to type=inline,mode=max \
		--build-arg BUILDKIT_INLINE_CACHE=1 \
		--provenance=false \
		--push \
		-f backend/Dockerfile \
		.
	@echo "Push complete: $(IMAGE_NAME):$(IMAGE_TAG) ($(SECONDARY_TAG))"

## build-local: Fast local build (native platform, no push)
build-local:
	@echo "Building locally (native platform)..."
	cd .. && docker build \
		--tag $(IMAGE_NAME):local \
		-f backend/Dockerfile \
		.
	@echo "Local build complete: $(IMAGE_NAME):local"

## link-drivers: Dry-run — list orphan drivers that would link to existing users
link-drivers:
	@npx tsx scripts/link-orphan-drivers.ts

## link-drivers-apply: Link orphan driver profiles to existing matching user accounts
link-drivers-apply:
	@npx tsx scripts/link-orphan-drivers.ts --apply
