---
name: "responsive-space-utilisation"
description: "Outcome + verification protocol + standard location for the responsive space-utilisation program shipped 2026-09-10"
folder: "features"
tags: []
updatedAt: "2026-09-09T16:41:26.678Z"
author: "Backend Developer"
---

# Responsive space-utilisation program (shipped 2026-09-10 ~00:34 SGT)

Outcome: full-app mobile/tablet audit across ~100 routes; every cluster certified two-dimensionally (space utilisation + visual quality) by QA with screenshot/computed-style evidence; prod deployed at dd227f5d.

## Where the standard lives
- **Authoritative**: `frontend/docs/design-system.md` (commit be12c4bf) — control-density contract (44px coarse-pointer floor, pointer-based not width-based), responsive pairing rules for card grids (5 rules), size-consistency scale (one control-height per context, type steps from the design system, no oversize components), stale-bundle verifier lesson. Future features inherit it; QA gates against it.

## Verification protocol that worked
- Cache-cold sweeps (hard reload + computed-style reads + bundle-filename check) — caught 2 stale-artifact false findings AND the deploy-hygiene gaps.
- Reciprocal cross-lane review (backend↔frontend, never self-approve) — caught the 1px even-child divider + orphan guard.
- Evidence pack attached to gate verdicts (screenshots + computed styles), not assertions.

## Deploy facts
- Prod dd227f5d; rollback: pre-cutover-20260909T141854Z.env retained + fresh pre-cutover snapshot for this cut.
- Program report: plans/reports/pm-260910-responsive-space-audit.md

## State — SHIPPED

- 2026-09-10 00:34 SGT: prod live @ `dd227f5d` (cutover health ✓; read-only probes: bootstrap 200/24 carriers, cluster GETs 200, SPA shells 200, bundle markers present). QA two-dimensional gate PASS with evidence pack. Completion report: plans/reports/pm-260910-responsive-space-audit.md (SHIPPED state).
- Final wave (12 commits, 7d33df48→dd227f5d): dispatch card/bento/trips/shipments fixes, config record-table pairing + sort targets, shared floors (49269def, cf0b0db8), finance toolbar parity (1c29895a, 58cf20b1, 989e1e0b, 9d2667b5), suppliers filter row, docs codification (be12c4bf), review-polish (dd227f5d = 3 of 4 cross-lane review findings).
- Post-ship polish queue: literal-44px token drift in DetailedPlanGrid/MasterPlanGrid notes triggers (→ var(--control-touch-h)); QA 960px window sampling now covered by the WorkflowFinance lift.
