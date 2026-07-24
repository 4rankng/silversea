---
title: TransTing rebrand
status: in-progress
priority: P1
effort: medium
branch: main
tags: [frontend, branding, product-design]
created: 2026-07-24
---

# TransTing rebrand

Progress: 90% — 9 of 10 phase checks complete; browser design QA is blocked by enterprise localhost policy.

## Goal

Rebrand the existing Vietnamese logistics application from TingTing/NEPO product labels to **TransTing** across frontend and backend-generated user-facing surfaces while preserving all routes, data flows, roles, APIs, and internal package names.

## Requirements

- Expected output: the login screen, deep emerald application shell, dashboard browser title, onboarding/assistant labels and system prompt, PWA metadata, exported workbooks, fuel-voucher HTML/XLSX footers, and existing FAQ answers display TransTing with a reference-aligned app mark and dedicated transparent sidebar mark.
- Acceptance criteria: all named surfaces use the approved tagline and exact sidebar descriptor (`Quản lý vận tải và logistics`), the sidebar brand header does not overflow at desktop or mobile widths, primary CTAs use deep emerald, the dashboard remains fully functional at `/dashboard`, focused tests/build/UI checks pass, and the browser console has no new errors.
- Scope boundary: no auth, routing, financial logic, deployment, package-scope rename, or broad page redesign; backend changes are limited to user-facing assistant/export identity and one forward-only FAQ copy migration.
- Constraints: work directly on `main`, preserve the flat Vantai design language and established emerald sidebar, keep `@tingting/*` internal contracts unchanged, and use the supplied brand board as the visual source.
- Touchpoints: centralized brand copy and asset paths, shared brand/sidebar tokens, `Sidebar` brand markup and responsive CSS, `LoginPage`, `Layout`, onboarding labels, backend assistant system prompt, route-title fallback, workbook and fuel-voucher HTML/XLSX footers, browser/PWA metadata, push notifications, FAQ copy migration, and automated frontend/backend/migration brand-contract checks.

## Phase

- [ ] [Phase 01 — Implement and verify the rebrand](phase-01-rebrand.md) — browser capture pending

## Definition of done

- TransTing is the only user-facing product identity on scoped surfaces.
- Vietnamese intent copy is: “Vận tải thông minh. Doanh nghiệp vững mạnh.”
- Sidebar descriptor is: “Quản lý vận tải và logistics,” rendered with the transparent mark and without header overflow.
- Existing FAQ answers use TransTing copy while their question-derived semantic embeddings remain intact.
- Existing business behavior and public contracts are unchanged.
- Rebrand design QA is saved in `plans/260724-transting-rebrand/design-qa.md`; the existing root QA artifact remains untouched.
