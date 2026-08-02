# Deployment

## Platform

Silversea staging is a self-hosted Docker Compose deployment at `https://vantai.tingting.vip`. Backend and frontend images are published to GHCR and pulled by the server-side compose project under `/opt/vantai`.

## Commands

- Full matched-stack staging release: `make demo`
- Image publication only: `make demo-push`
- Pull, migrate, and recreate an already-published matched stack: `make demo-deploy`
- Public backend check: `make demo-health`

For a frontend-only release that intentionally leaves the backend and database unchanged:

1. Run frontend typecheck, tests, lint, context validation, and the production frontend build.
2. Publish with `cd frontend && make push`.
3. On staging, pull and recreate only the `frontend` service with the production compose file.
4. Verify public health, the newly served asset hashes, authenticated routes, console/network errors, and desktop/tablet/mobile screenshots.

## Configuration

Runtime environment values remain server-managed. Never copy secrets into this document, QA artifacts, image tags, or command output. Image publication requires an authenticated GHCR session with package-write access and staging cutover requires authorized SSH access.

## Rollback

Record the running container image ID before every cutover. If the new frontend is defective, retag or repoint `ghcr.io/4rankng/transting-frontend:latest` to the recorded image, pull it on staging, and force-recreate only the frontend service. A frontend-only rollback does not touch the database volume.

For schema or backend releases, use the fuller safeguards in `docs/journals/staging-redeploy-runbook.md`; never wipe the staging database volume during a routine deployment.
