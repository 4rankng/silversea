# Phase 2 — Signed-off adoption targets

User signoff captured via `AskUserQuestion` on 2026-07-19. Selections:

- Picked: **T1, T2, T3, T4** + open invitation to add daisyUI-native wins.
- Sparkline renderer: **Hand-rolled SVG** (no new deps).
- Demo page: **DashboardPage**.

The daisyUI invitation maps cleanly to **T5 (Tabs)** — 5 pages already hand-roll `role="tab"` markup inline, and daisyUI ships a `.d-tabs` primitive that already matches NEPO tokens via the `nepo` theme. Zero new deps, high DRY value, clear scope.

## Final adoption list (5 items — under the cap of 6)

| # | Item | Source | Lands in | New dep? | Est. |
|---|---|---|---|---|---|
| T1 | EmptyState with skeleton-placeholder previews | `a-c-empty-states-05` (Tailkit) → retokenize | `components/shared/EmptyState.tsx` (extend) | No | 1.5h |
| T2 | KPI sparkline trend | `a-c-statistics-11` inspiration only → hand-roll SVG | new `design-system/Sparkline.tsx` + extend `KPI` | No | 2h |
| T3 | Persistent dismissible Banner | `a-c-banners-01..08` inspiration → daisyUI `.d-alert` + `.d-toast` patterns | new `components/shared/Banner.tsx` | No | 1.5h |
| T4 | Command palette (Cmd+K) | `a-c-command-palettes-07` inspiration → hand-roll over Radix Dialog or portal | new `components/shared/CommandPalette.tsx` + hook | No | 4h |
| T5 | Shared Tabs primitive (daisyUI-native, DRY 5 pages) | daisyUI `.d-tabs` (already in deps) | new `design-system/Tabs.tsx` | No | 1.5h |

**Total estimated effort:** ~10.5h (within plan's 2-3 day budget).

## Why these five, in plain language

- **T1** — first-run users see "Không có dữ liệu" + icon. Tailkit pattern shows faded preview cards behind the message so users can *visualize* what content will look like. Pure additive variant on existing `EmptyState`; no API change.
- **T2** — current `KPI` shows a single static number + watermark icon. Adding an inline sparkline (last 7/30 days) gives instant trend context on the dashboard. Hand-rolled SVG keeps the zero-deps rule. Pure additive optional prop.
- **T3** — `Alert` is inline-only today. A persistent page-top banner is needed for notices like "Kỳ lương đã khoá", "Hệ thống bảo trì 23:00", etc. daisyUI's `.d-alert` + sticky positioning makes this a small lift.
- **T4** — power users (accountants, directors) navigate 36 pages today via sidebar clicks. Cmd+K palette lets them jump to `/debt/123`, "Tạo chuyến mới", "Báo cáo P&L" in two keystrokes. Largest scope item but biggest UX win.
- **T5** — `role="tab"` is hand-rolled in 5 files (`PeriodFilter.tsx`, `DebtDetailPage.tsx`, `PayableListPage.tsx`, `chatbot-monitoring-details.tsx`, `chatbot-monitoring-summary.tsx`). A `design-system/Tabs.tsx` over daisyUI `.d-tabs` DRYs this up. *Note:* `DebtDetailPage` and `PayableListPage` are sibling-plan-owned, so they're migrated only after that plan ships.

## Excluded (with reason)

| # | Item | Why excluded |
|---|---|---|
| T6 | Steps/wizard | YAGNI — no wizard-shaped feature currently planned. Revisit when forwarder-settlement-create or debit-note-template-editor wants a multi-step flow. |
| T7 | Progress bar | Trivial but low value — no file-upload progress or long-form-completion UX in current scope. |

## Sequencing (Phase 4-5 order)

1. **T5 (Tabs)** first — smallest, highest-leverage DRY. Establishes the retokenization + barrel-export pattern that T1-T4 will follow.
2. **T1 (EmptyState)** — quick win; lands on DashboardPage demo immediately.
3. **T3 (Banner)** — small, fills real gap; can demo on DashboardPage.
4. **T2 (Sparkline + KPI)** — adds SVG utility; demo on DashboardPage KPIs.
5. **T4 (Command palette)** — largest scope; lands last so the demo page is already polished when it arrives.

## Success criteria for Phase 2 (this document)

- [x] ≤6 items, each scored and tied to file paths.
- [x] User has signed off via `AskUserQuestion`.
- [x] At least one item is *MISSING* (new capability): T4 Command palette.
- [x] No target lands on `DebtDetailPage` / `PayableDetailPage` *as authors of change*. (T5 Tabs will *eventually* migrate them, but only after the sibling plan ships — see Phase 5 exclusion.)
