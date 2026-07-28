# Docker build memory and image pruning

Date: 2026-07-27  
Status: completed

## Root cause

The reported failure was Node's TypeScript compiler reaching its approximately
768 MB heap limit inside the Docker builder. The `765–784 MB` values in the
garbage-collection trace were memory usage, not Docker build-context transfer.

The repository also had two independent sources of unnecessary build weight:

- the shared root context could include QA evidence, generated graphs, build
  output, test output, uploads, coverage, and migration snapshots;
- workspace installation executed the root Puppeteer postinstall and downloaded
  Chromium even though neither application image requires browser automation.

## Changes

- Retained the 2 GB Node heap limit for both TypeScript image builders.
- Added Dockerfile-specific allowlists for backend and frontend builds.
- Excluded tests from the backend production TypeScript output while retaining
  the full repository typecheck gate.
- Excluded frontend/shared test sources from image build contexts.
- Prevented Puppeteer browser downloads in ephemeral builder stages.
- Replaced backend runtime workspace installation with a deployed,
  production-only backend dependency tree.
- Shipped only Drizzle migration SQL and `meta/_journal.json`; schema-generation
  snapshots remain development artifacts.

## Evidence

- Cold backend AMD64 build: green  
  `qa/2026-07-27_docker-pruning_backend-image-build.rerun.log`
- Backend runtime inspection: green  
  `qa/2026-07-27_docker-pruning_backend-image-inspection.log`
- Cold frontend AMD64 build: green  
  `qa/2026-07-27_docker-pruning_frontend-image-build.log`
- Frontend runtime inspection: green  
  `qa/2026-07-27_docker-pruning_frontend-image-inspection.log`
- Local backend production compilation: green  
  `qa/2026-07-27_docker-pruning_backend-build.log`

Measured results:

- backend runtime image: 399 MB before, 99.2 MB after;
- frontend runtime image: 34.0 MB;
- frontend cold context: 12.53 MB;
- backend production ESM rewrite count: 1,480 files before, 951 after removing
  tests from production compilation;
- runtime checks prove no Puppeteer package, compiled backend tests, Drizzle
  snapshots, or source workspace is present.
