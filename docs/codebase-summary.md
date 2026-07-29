# Codebase Summary

Repository snapshot generated from `repomix-output.xml` on 2026-07-29.

## Overview

Silversea is a Vietnamese trucking and logistics platform with a React/Vite frontend, an Express + Drizzle backend, and a shared package for contracts, navigation, and financial calculations. The repo also contains authenticated end-to-end tests, regression-testing documentation, deployment scripts, and durable implementation plans.

## Main Surfaces

| Area | Purpose |
| --- | --- |
| `frontend/` | Role-based UI, route guards, workspace pages, design system, and feature-specific tests. |
| `backend/` | API routes, services, jobs, auth/RBAC, and database access through Drizzle. |
| `shared/` | Cross-app types, constants, navigation catalog, and calculation helpers. |
| `e2e/` | Authenticated workflow coverage for product flows. |
| `docs/` | Evergreen docs, PRD references, and regression-testing guidance. |
| `plans/` | Active and historical implementation plans with phase reports. |

## Current Navigation Pattern

- `/advances` is the canonical office workspace for both advance requests and settlement review.
- `/admin/advance-settlements` remains as a legacy compatibility route and redirects to `/advances?view=settlements`.
- `/governance-actions` stays separate as `Trung tâm phê duyệt`, the authority queue for final decisions.

## Architectural Notes

- The frontend uses role-gated routes and shared navigation labels to keep sidebar, search, and page titles aligned.
- The backend continues to expose the financial and governance APIs independently of the UI consolidation.
- Shared financial behavior is centralized in reusable helpers rather than duplicated in pages.
- Existing docs under `docs/regression-testing/` still provide module-level acceptance cases and should be kept in sync with the canonical workspace names.

## Documentation Status

- Regression-testing pages for M04, M09, and M11 were updated to reflect the canonical `/advances` workspace and the separate governance queue.
- The repo still relies on the existing PRD source docs in `docs/prd/` for business rules and decision history.
