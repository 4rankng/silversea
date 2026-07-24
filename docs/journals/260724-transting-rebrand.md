---
title: TransTing rebrand
date: 2026-07-24
status: implemented
---

# TransTing rebrand

## Context

The application product identity moved from TingTing/NEPO labels to **TransTing** across frontend and backend-generated user-facing surfaces, keeping the user-directed deep emerald sidebar and primary CTAs with a unified emerald-and-white route-T mark.

## What changed

- Added a new road/arrow app mark with favicon and PWA sizes plus a dedicated transparent sidebar mark for the emerald shell.
- Added dedicated maskable Android icons and opaque iOS touch icons; automated checks enforce install metadata and a conservative foreground safe zone.
- Replaced the overly detailed tab favicon with a two-color white route-T on emerald, optimized and inspected at 16 px and 32 px; versioned favicon URLs force browsers to refresh the cached icon.
- Added a reproducible asset generator backed by the checked-in ImageGen master and pixel-level contract checks so malformed icons cannot pass on path existence alone.
- Centralized the product name, tagline, exact sidebar descriptor (`Quản lý vận tải và logistics`), and runtime logo paths.
- Fixed the sidebar brand header so the descriptor wraps within its flex column instead of overflowing the 248 px desktop/mobile shell.
- Aligned custom, DaisyUI, and token-driven primary CTAs to deep emerald with a darker emerald hover state.
- Updated login, sidebar, browser/PWA metadata, push notifications, assistant/onboarding labels, the backend assistant system prompt, route-title fallback, workbook metadata, fuel-voucher HTML/XLSX footers, and product documentation.
- Added forward-only migration `0108_transting_product_identity.sql` to replace TingTing in existing FAQ answers while preserving question-derived embeddings.
- Expanded the brand-contract check to prevent scoped frontend, backend assistant/export, and FAQ migration surfaces from restoring legacy product labels.

## Decisions

- Keep `@tingting/*` package names and other internal identifiers unchanged; this is a product identity change, not a monorepo migration.
- Keep NEPO where it names the operating company or business domain.
- Update persisted FAQ copy forward-only while preserving embeddings because the embedding input contains only the unchanged question and variants.
- Preserve semantic success, warning, danger, and info colors; primary CTA, shell, and brand-mark surfaces use deep emerald and white.
- Approved copy:
  - `Vận tải thông minh. Doanh nghiệp vững mạnh.`
  - `Quản lý vận tải và logistics`

## Verification

- Full frontend tests: 36 files / 186 tests passed.
- UI and expanded brand contract checks passed, including frontend assets/copy, backend assistant and fuel-voucher sources, and the FAQ migration contract.
- Production build passed.
- Package-wide frontend lint passed with no errors (62 existing warnings).
- Backend type-check passed. The full backend suite passed 730 tests with one todo and no failures.
- Mobile launcher previews passed for iOS square and Android adaptive square, circle, and squircle crops; install-icon safe zones are guarded by the brand contract.
- `git diff --check` passed.

## Remaining evidence

Browser-rendered desktop/mobile QA is blocked because enterprise browser policy rejects `localhost:7173`. The source asset and generated small-size assets were inspected, but login, dashboard interactions, responsive wrapping, and console output still need capture in an allowed browser environment. See `plans/260724-transting-rebrand/design-qa.md`.
