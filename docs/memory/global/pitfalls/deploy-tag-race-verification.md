---
name: "deploy-tag-race-verification"
description: "Contains the 2026-09-10 staging :latest tag-race incident: why a one-time bundle-flip check proves nothing, the two-stage make-demo kill, rollback-snapshot forensics, and the single-deployer rule"
folder: "global / pitfalls"
tags: []
updatedAt: "2026-09-09T19:24:01.530Z"
author: "BackEnd (backend)"
---

# Deploy tag-race verification trap (2026-09-10 incident)

## What happened
During the 09-10 search-fix chain, staging (vantai) was cut FOUR times in ~20 minutes by two actors on one shared `:latest` tag: my sanctioned `make demo` (19:02Z) verified the served bundle flip (`index-B3rdCylR` → my `index-DZTJqxYT`), but a rogue desktop-spawned backlog executor's late-completing `buildx --push` overwrote `:latest` AFTER my check, and its cutover at 19:06Z re-pulled its own older build (`index-DSDIvJnQ`, pre-fix content). My "flip observed" declaration was true when made and false minutes later.

## The rules that follow
- **A bundle-hash flip observed once proves nothing about the future** — `:latest` is a mutable shared pointer; a concurrent push (another agent, a retrying CI, an unfinished build) can steal it seconds later. Declare a cut ONLY with fetched-content evidence: served `index.html` entry hash == the exact built image's entry hash (`docker run --rm --entrypoint cat <image> /usr/share/nginx/html/index.html`), AND served JS contains a marker only the new build has (e.g. the new pattern/message), AND the replaced marker is ABSENT.
- **Killing a `make demo` mid-run is two-stage**: TaskStop kills the pipeline, but the `make` orchestrator and `buildx` children survive — kill the make PID first (so it cannot advance to the server phases), then the buildx PIDs; verify with `ps` that both are gone. A killed `buildx --push` may still complete its manifest push server-side (BuildKit backend), so a "killed" build can still win a later tag race.
- **Rollback-snapshot history is the ground truth for cutover forensics**: `ssh root@vantai.tingting.vip "ls -lt /opt/vantai/.deploy-rollbacks"` timestamps every cutover — use it to attribute cuts when multiple actors deploy.
- **One deployer per wave** — a run/pipeline with multiple agents must name a single cut owner; "verification-only" rulings must be enforced (console closure) before a cut, not after a tag theft.
- Related: [[testing-and-deploy-environments]], [[main-prod-merge-readiness]].
