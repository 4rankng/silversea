---
phase: 1
title: Implement and verify the rebrand
status: in-progress
---

# Phase 01 — Implement and verify the rebrand

Progress: 9/10 checks complete; public desktop/mobile verification follows deployment.

## Implementation

1. Generate a square TransTing road/arrow brand mark matching the supplied reference direction, plus a simplified high-contrast favicon silhouette that remains legible at 16 px; save responsive PNG sizes without overwriting legacy files.
2. Keep the established deep emerald sidebar and primary actions, use one emerald-and-white route-T across brand surfaces, and retain signal green for secondary accents while preserving semantic status colors and flat surfaces.
3. Replace user-facing TingTing/NEPO identity on the login screen, sidebar, browser/PWA metadata, application version, assistant/onboarding labels, backend assistant system prompt, route-title fallback, fuel-voucher HTML/XLSX footers, workbook metadata, and existing FAQ copy.
4. Add focused brand-contract coverage for required TransTing strings, forbidden legacy labels in scoped frontend/backend sources, and the forward-only FAQ migration contract.

## Checklist

- [x] Generate and install the TransTing app mark, favicon-specific mark, and responsive PWA assets.
- [x] Add a compact transparent sidebar mark and constrain the Vietnamese brand descriptor so it cannot overflow the shell.
- [x] Centralize the approved Vietnamese identity copy.
- [x] Rebrand login, sidebar, titles, assistant/onboarding, backend assistant prompt, workbook/fuel-voucher exports, PWA, and push-notification surfaces.
- [x] Apply emerald primary CTA/shell tokens and a unified emerald-and-white mark without changing semantic status colors.
- [x] Add the forward-only FAQ copy migration and automated frontend/backend/migration brand-contract coverage.
- [x] Add dedicated `any` and `maskable` install icons, iOS touch icons, standalone metadata, and automated mobile safe-zone checks.
- [x] Pass focused and full frontend tests.
- [x] Pass UI contract, production build, changed-file lint, and diff hygiene.
- [x] Complete adversarial code review and resolve all P0–P2 code findings.
- [ ] Capture and pass desktop/mobile browser design QA.

## Verification

- Run focused route and onboarding tests plus the expanded frontend/backend/migration brand-contract check.
- Run `pnpm --filter @tingting/frontend run check:ui`.
- Run the frontend test suite and production build.
- Run changed-file lint and `git diff --check`.
- Verify iOS, Android adaptive-circle, adaptive-squircle, and small-icon previews keep the route-T clear and uncropped.
- Verify login and `/dashboard` at desktop and mobile widths, primary navigation, title/manifest, and browser console.
- Compare the rendered brand surfaces with the supplied reference and record the result in `design-qa.md`.

## Risks and rollback

- Internal `@tingting/*` names remain unchanged to avoid a cross-monorepo contract migration.
- The FAQ migration is forward-only and preserves embeddings because they are derived exclusively from the unchanged question and variants.
- If the generated mark loses clarity at 40px, use the same mark with a tighter crop rather than changing the UI footprint.
- Rollback is limited to the files listed in the phase report and the newly added TransTing assets.
