---
phase: 2
title: Discoverable responsive workflow
status: completed
effort: large
---

# Phase 02 — Discoverable responsive workflow

## Scope

Use the existing shipment pages and dossier editor as the canonical operational flow without creating a second dispatch implementation.

## Files

- `frontend/src/App.tsx`
- `frontend/src/lib/routes.ts`
- `frontend/src/api/shipmentClient.ts`
- `frontend/src/pages/ShipmentsPage.tsx`
- `frontend/src/pages/ShipmentsPage.css`
- `frontend/src/pages/ShipmentDetailPage.tsx`
- `frontend/src/pages/ShipmentDetailPage.css`
- `frontend/src/pages/clerk/ClerkShipmentCreatePage.tsx`
- `frontend/src/pages/clerk/ClerkShipmentDocsPage.tsx`
- shipment page/route tests

## Requirements

- Add role-aware create CTA on `/shipments`: ADMIN/MANAGER only; ACCOUNTANT remains read-only.
- Admit MANAGER to the existing dossier route so its already-authorized review/dispatch controls are reachable.
- After CLERK quick-create, navigate to `/clerk/shipments/:id/docs`, not the forbidden office detail.
- Add edit/dispatch handoff from office detail for ADMIN/MANAGER.
- Add accepted workbook fields to create/edit/display with conditional FCL/LCL grouping.
- Send `q` to the backend and remove page-local search wording/behavior.
- Preserve `/dispatch` as the post-trip fleet workspace.
- Flat sections, readable Vietnamese labels, wrapping long references, 44px actions, and no viewport overflow at 320/390/768/1024/1440px.

## Verification

- Focused Vitest/Testing Library coverage for role visibility, routing, field payloads, server search, and mobile CSS.
- Browser checks using ADMIN, MANAGER, ACCOUNTANT, and CLERK at desktop and mobile widths when the local stack is available.

## Risks and rollback

- Route visibility can accidentally broaden authority; frontend guards mirror the already-authorized backend role matrix and no Casbin policy changes.
- Existing clerk tests may assume the incorrect office-detail redirect; update them to the allowed dossier route.
- Rollback is route/UI-only and does not require data rollback.

## Done

- [x] Role-safe create/edit/dispatch links are reachable from the shipment workflow.
- [x] New fields are created, edited, and displayed for FCL and LCL.
- [x] Search is server-backed and responsive tests pass.
