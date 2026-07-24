# Project Roadmap

> **Audience:** Project leads and developers tracking progress. Links to specific plan documents for implementation details.

## Completed Features

### Core Platform (Shipped)

| Feature | Description | Key Docs |
|---------|-------------|----------|
| **Trip lifecycle (E2E)** | Full 5-state lifecycle: Created -> In Transit -> Completed -> Locked -> Canceled. Trip-by-trip locking with ledger posting. | [01-TRIP_LIFECYCLE](flows/01-TRIP_LIFECYCLE.md), [PRODUCT-SPECS.md §4.1](../PRODUCT-SPECS.md) |
| **Financial ledger** | Append-only double-entry ledger for customers, vendors, and drivers. Revenue ex-VAT, costs incl-VAT. | [CONTEXT.md](../CONTEXT.md), [04-CONG_NO_VA_THANH_TOAN](flows/04-CONG_NO_VA_THANH_TOAN.md) |
| **P&L reporting** | Monthly profit/loss with gross profit per truck, net profit for the company, management fee deduction. | [03-DASHBOARD_VA_BAO_CAO](flows/03-DASHBOARD_VA_BAO_CAO.md) |
| **Receivables & payables** | Customer debt tracking with manual FIFO payment matching. Vendor payables with aging. | [04-CONG_NO](flows/04-CONG_NO_VA_THANH_TOAN.md), [12-CHI_PHI_NCC](flows/12-CHI_PHI_NCC_VA_CONG_NO_PHAI_TRA.md) |
| **Salary & attendance** | Monthly salary periods, driver work-day tracking, auto trip-wage fill, unlock capability. | [14-LUONG_VA_CHAM_CONG](flows/14-LUONG_VA_CHAM_CONG.md) |
| **Config system (24+ tables)** | CRUD factory pattern for customers, trucks, trailers, routes, suppliers, expense items, fuel config, etc. | [09-CAU_HINH](flows/09-CAU_HINH_HE_THONG.md) |
| **RBAC (5 roles)** | ADMIN, MANAGER, ACCOUNTANT, DRIVER, FORWARDER with dual-layer Casbin enforcement. | [00-OVERVIEW](flows/00-OVERVIEW_VA_PHAN_QUYEN.md) |

### Extended Features (Shipped)

| Feature | Description | Key Docs |
|---------|-------------|----------|
| **Tire management** | Full lifecycle: install, transfer, spare. Backend `POST /transfer` (atomic), assertPositionFree guard. | [15-QUAN_LY_LOP_XE](flows/15-QUAN_LY_LOP_XE.md) |
| **Vehicle alerts** | Configurable alerts for oil service, registration, insurance renewal (last-date + N-month interval). | [07-DOI_XE](flows/07-DOI_XE_VA_FLEET.md) |
| **Trip instructions** | Per-trip instruction notes with before-departure delivery flow. | |
| **Debit-note templates** | Form-driven XLSX template builder per customer. `debit_note_templates` table + frozen JSON snapshot. | [giay-bao-no-template-system](../.claude/projects/-Users-dev-Documents-projects-nepocorp/memory/giay-bao-no-template-system.md) |
| **OCR (container/seal)** | OpenRouter Qwen3-VL-32B primary + Gemini fallback. Auto-fills on upload with ISO 6346 check-digit validation. | [plans/ocr-openrouter-qwen-migration.md](plans/ocr-openrouter-qwen-migration.md) |
| **Bach Khoa GPS tracking** | Live vehicle tracking via Bach Khoa portal API. Pull-through Redis cache. | [plans/gps-actual-route-database.md](plans/gps-actual-route-database.md) |
| **Agent chatbot** | MiniMax-M3 LLM + Socket.io + tool-use orchestration. Navigate/highlight, tour engine, admin perf monitoring. | [plans/agent-semantic-data-gateway.md](plans/agent-semantic-data-gateway.md) |
| **Mobile push notifications** | Web Push API + service worker. Notification bell dropdown with unread badge and mark-all-read. | |
| **Notification deeplinks** | Clickable notifications navigate to relevant entity pages. | [plans/deeplink-all-pages.md](plans/deeplink-all-pages.md) |
| **Forwarder portal** | Mobile-first portal for forwarders. Container/seal entry, advance fund management, ancillary cost recording. | [13-GIAO_NHAN](flows/13-GIAO_NHAN_VA_TAM_UNG.md) |
| **Forwarder approval workflow** | Office UI to approve forwarder settlements (hoan ung). Hooks for approval process. | [plans/feedback-remaining-blueprint.md](plans/feedback-remaining-blueprint.md) |
| **Service-fee backfill** | Chi ho SERVICE_FEE accounts-receivable backfill applied to production (118 rows, 9 customers). | [service-fee-backfill-applied-prod](../.claude/projects/-Users-dev-Documents-projects-nepocorp/memory/service-fee-backfill-applied-prod.md) |

## In Progress / Planned

### Active Plans

| Plan | Status | Description |
|------|--------|-------------|
| [Feedback remaining blueprint](plans/feedback-remaining-blueprint.md) | Planned | Office UI to approve forwarder settlements/hoan ung. Hooks exist but approval UI is orphaned. |
| [Architecture refactor consensus](plans/architecture-refactor-consensus-plan.md) | Planned | pgEnum consolidation (18 -> fewer), `enum-sync.ts` in backend, CI service-container split (1a/1b PRs), eslint non-blocking. |
| [Agent semantic data gateway](plans/agent-semantic-data-gateway.md) | Planned | Harden existing 6-tool gateway + add `report.run` tool + retire 45 narrow tools. Fix `ledger.aggregateMetrics` meaningless SUM balance. |
| [Chatbot latency reduction](plans/chatbot-latency-reduction.md) | Planned | Reduce live p95 (~17s) below 12s threshold. |
| [Bot navigate and spotlight](plans/bot-navigate-and-spotlight.md) | Planned | Fix MiniMax-M3 ignoring navigate prompt + expose highlight param + honest guardrails. |
| [Deeplink all pages](plans/deeplink-all-pages.md) | Planned | Consolidate `buildNotifPath()` into `lib/routes.ts`, fix 2 silent-drop bugs (sw.js, NOTIFICATION_CLICK listener). |

### Spec Compliance Gaps

Identified during [architecture audit 2026-06-27](plans/architecture-audit-2026-06-27.md) and [spec compliance audit](../.claude/projects/-Users-dev-Documents-projects-nepocorp/memory/spec-compliance-audit-2026-06-18.md):

| Gap | Status | Notes |
|-----|--------|-------|
| P&L service-margin double-count | Pending sign-off | ~7.97M + 2.5M VND divergence. Requires Pete decision. |
| STANDBY_LABOR not posted to ledger | Pending | Standby labor cost not recorded in ledger. |
| Penalty not double-entry in ledger | Pending | Penalty revenue/salary deduction gap. |
| 5 missing tables | Partially shipped | vehicle_alerts, truck_profit_distribution, commission_type, container types fields, salary_periods totals. Some created post-audit. |
| Gross-profit recost sign-off | Pending | See [plans/grossprofit-recost-signoff.md](plans/grossprofit-recost-signoff.md). |

## Deferred / Out of Scope

| Item | Reason | Notes |
|------|--------|-------|
| **GPS tracking (public API)** | Bach Khoa vendor hasn't enabled public API access | Portal API works; public API returns "Khong co quyen truy cap". GPS live tracking shipped via portal scrape. |
| **Variable pricing** | Fixed Customer x Route pricing sufficient | Per [PRODUCT-SPECS.md §4.2](../PRODUCT-SPECS.md). May reconsider later. |
| **E-invoice generation** | Out of scope | System records data; external invoicing is separate. |
| **Multi-company / multi-tenant** | Single company (NEPO) | No architectural support needed. |
| **Formal Order entity** | Customer Reference field on Trip serves as grouping | See [CONTEXT.md](../CONTEXT.md) for rationale. |
| **Native mobile apps** | Mobile-first web sufficient | Progressive web app approach. |

## Infrastructure Improvements Needed

| Item | Description | Priority |
|------|-------------|----------|
| **CI/CD billing recovery** | GitHub Actions blocked since ~2026-06-16; manual deploy via `make push` + SSH | High |
| **Frontend buildx cache** | Docker build ~100s slow due to `--cache-from type=registry` + docker-container driver | Medium |
| **Docker Hub mirror** | Registry reliability for production pulls | Medium |

## Track Structure

Mirrors `TASKS.md` two-track model:

- **Track 1 (Trip Lifecycle Epic):** Completed. Full E2E trip management with financial recording.
- **Track 2 (Feature Backlog):** Active. Contains remaining spec-compliance gaps, architecture refactoring, and planned enhancements listed above.

## Related Documents

| Document | Purpose |
|----------|---------|
| [Product Overview](project-overview-pdr.md) | Business scope and personas |
| [Product Specs](../PRODUCT-SPECS.md) | Full business rules specification |
| [Deployment Guide](deployment-guide.md) | Dev/prod/demo environments |
| [System Architecture](system-architecture.md) | Technical architecture |
