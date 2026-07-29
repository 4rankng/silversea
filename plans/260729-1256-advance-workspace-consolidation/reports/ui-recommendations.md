# UI recommendations — Tạm ứng & hoàn ứng

## Outcome

Consolidate `/advances` and `/admin/advance-settlements` into one canonical office workspace:

- Page title and sidebar label: **Tạm ứng & hoàn ứng**
- Canonical URL: `/advances`
- Workspace views: `?view=requests` and `?view=settlements`
- Default view: `requests`
- Legacy `/admin/advance-settlements` redirects to `/advances?view=settlements`, preserving `focus` and other relevant query parameters.
- `/governance-actions` remains a separate destination named **Trung tâm phê duyệt**.

This is an information-architecture and copy clarification, not a workflow rewrite. No API, database, RBAC, status lifecycle, financial calculation, or settlement-detail behavior changes.

## Product model users should understand

The two destinations have different jobs:

1. **Tạm ứng & hoàn ứng** is the operational record workspace. Staff review source data, enter a reason, open a settlement, and **send a proposal** into the decision flow.
2. **Trung tâm phê duyệt** is the authority workspace. Authorized staff **check, approve, or reject** the proposal.

Reserve the verbs **“Kiểm tra”**, **“Phê duyệt”**, and **“Từ chối”** without a qualifier for final governance actions. In the operational workspace, use **“Gửi đề nghị…”** so a maker action is never mistaken for final approval.

## Canonical workspace structure

```text
Tạm ứng & hoàn ứng
Theo dõi yêu cầu tạm ứng, số dư chưa hoàn và phiếu hoàn ứng.
Các thao tác tại đây gửi đề nghị; quyết định cuối cùng được thực hiện tại Trung tâm phê duyệt.

[ Yêu cầu tạm ứng · n ] [ Phiếu hoàn ứng · n ]

┌ Active view summary/KPIs ──────────────────────────────────────┐
│ Status filters                                                 │
│ Existing request table/cards OR existing settlement ledger/cards│
└────────────────────────────────────────────────────────────────┘
```

Use native links for the two workspace views, not `div` controls. The selected link gets `aria-current="page"`. Query-backed views preserve deep linking, reload behavior, browser history, and Cmd/Ctrl-click semantics without creating two competing top-level pages.

### Exact workspace copy

| Element | Vietnamese copy |
|---|---|
| Page/sidebar/browser title | `Tạm ứng & hoàn ứng` |
| Header description | `Theo dõi yêu cầu tạm ứng, số dư chưa hoàn và phiếu hoàn ứng. Các thao tác tại đây gửi đề nghị; quyết định cuối cùng được thực hiện tại Trung tâm phê duyệt.` |
| Primary view 1 | `Yêu cầu tạm ứng` |
| View 1 helper | `Xem yêu cầu của giao nhận và gửi đề nghị duyệt hoặc từ chối.` |
| Primary view 2 | `Phiếu hoàn ứng` |
| View 2 helper | `Đối chiếu chi phí, số tiền hoàn lại và trạng thái xử lý của từng phiếu.` |
| Link to governance | `Mở Trung tâm phê duyệt` |
| Request positive action | `Gửi đề nghị duyệt` |
| Request negative action | `Gửi đề nghị từ chối` |
| Request reason label | `Lý do đề nghị` |
| Settlement detail action | `Mở phiếu` or `Kiểm tra phiếu` when the role can check it |
| Settlement negative maker action | `Gửi đề nghị từ chối` if this mutation creates a governance request |
| Request empty title | `Không có yêu cầu tạm ứng trong phạm vi này` |
| Request empty helper | `Chọn trạng thái khác để xem lịch sử yêu cầu.` |
| Settlement empty title | `Không có phiếu hoàn ứng trong phạm vi này` |
| Settlement empty helper | `Chọn trạng thái khác để xem lịch sử phiếu.` |

Do not keep the current request-page description `Duyệt hoặc từ chối yêu cầu tạm ứng`; it implies immediate authority. Do not keep `Duyệt hoàn ứng` as the workspace view name or `Kiểm tra & hoàn tất` as the settlement list action; both overstate what happens before final governance.

## Trung tâm phê duyệt

Keep `/governance-actions` outside the consolidated workspace and out of its tab bar.

### Exact copy

| Element | Vietnamese copy |
|---|---|
| Page/sidebar/browser title | `Trung tâm phê duyệt` |
| Header description | `Kiểm tra và phê duyệt các đề nghị tài chính, vận hành theo thẩm quyền được giao.` |
| Queue heading | `Việc cần xử lý` |
| Pending filter | `Đang chờ` |
| History filter | `Tất cả` |
| Final actions | `Kiểm tra`, `Phê duyệt`, `Từ chối` |
| Rejection field | `Lý do từ chối` |
| Empty pending state | `Không có đề nghị nào cần xử lý` |
| Empty pending helper | `Mở “Tất cả” để xem lịch sử quyết định.` |

Keep the current governance capabilities: actionable/pending/check/approval counts, refresh, pending/history filter, subject and maker facts, proposal reason, evidence, permission display, salary-specific finalization, version-aware mutations, and inline errors.

## Functionality retention matrix

| Existing surface | Must remain in consolidated result |
|---|---|
| `/advances` | Request status KPIs, outstanding-advance KPI, status filters and counts, desktop rows, mobile cards, focus deep link, reason entry, proposal submission, loading/empty/history states |
| `/admin/advance-settlements` | Pending/approved/outstanding KPIs, all status filters including `Đã hoàn tác`, grouped trip/expense ledger, refund and expense totals, settlement/trip links, role-specific read/action state, focus deep link, mobile plan detail, reject proposal |
| `/governance-actions` | Entire final decision queue; no cards or final decision buttons copied into the operational workspace |

Role behavior must remain as implemented:

- ADMIN, MANAGER, and ACCOUNTANT retain access to the consolidated office workspace.
- Existing mutation/RBAC authority remains unchanged.
- MANAGER keeps read-only settlement behavior where currently enforced.
- ADMIN and ACCOUNTANT retain existing settlement check/reject affordances.
- Governance action buttons continue to render strictly from `allowedActions`.

## Responsive behavior

### Desktop — 1100px and wider

- Header: title/helper on the left; optional `Mở Trung tâm phê duyệt` text link on the right.
- Workspace navigation: two 44px-high links in one bordered row, not floating pills.
- Keep the active view’s existing KPI set only. Do not combine request and settlement KPIs into a large dashboard.
- Requests use the current dense grid.
- Settlements retain the grouped ledger and its contained, keyboard-focusable horizontal scroll region. Page/body itself must not scroll horizontally.
- Use solid surfaces, 1px dividers, and tabular numbers. Remove decorative gradients and elevated card shadows from these two pages.

### Tablet — 768px to 1099px

- Keep the two workspace links in one equal-width row.
- KPIs use two columns with `minmax(0, 1fr)`.
- Switch **both** request and settlement data to cards at or below 1023px. The current request grid waits until 820px and can become wider than the available content area when the application shell/sidebar is considered.
- Settlement cards may use two columns only when each card has at least 340px available; otherwise use one column.
- Never expose the 1096px settlement ledger on tablet.

### Mobile — 320px to 767px

- Page gutter follows the existing shell; every child uses `min-width: 0` and `max-width: 100%`.
- Two workspace links stay in a 2-column row, minimum height 44px. Labels wrap to two lines if needed; do not create a horizontally scrolling tab strip.
- KPIs stay in a 2-column grid. At 320px, allow labels/meta to wrap and keep the currency inside its card.
- Replace the 4–5 status pills with a labelled, full-width native select:
  - Label: `Lọc theo trạng thái`
  - Preserve every current option and count.
- Render only cards, never desktop grids/ledger.
- Request reason field is full width, visibly labelled, at least 44px high, and `font-size: 16px`.
- Actions stack or use two equal columns only when both labels fit. Every button is at least 44px high; icon-only controls are at least 44×44px.
- Long names, reasons, routes, expense labels, status text, and currency values wrap with `overflow-wrap: anywhere`; no ellipsis for decision-critical text.
- No page-level horizontal overflow at 320px, 390px, or landscape phone width.

## Accessibility and keyboard contract

- Implement clickable KPIs as real `<button type="button">` elements with `aria-pressed`, not `div role="button"`. This fixes the current Enter-only behavior and provides Space activation automatically.
- Workspace navigation is `<nav aria-label="Tạm ứng và hoàn ứng">` containing links with `aria-current="page"`.
- Give every icon-only request/reject action an `aria-label`; `title` alone is insufficient.
- Keep a visible `:focus-visible` indicator with at least 2px contrast on links, buttons, filters, the settlement ledger region, and inputs.
- Use visible labels for reason fields; placeholder text is an example, not the label.
- Async list loading uses `role="status"`/`aria-live="polite"`. Inline failures remain `role="alert"`.
- Disabled/busy buttons keep their label, add a spinner, and cannot be submitted twice.
- Status meaning always includes readable text; never rely on the colored strip alone.
- Maintain heading order: one page `h1`, then active-view `h2`, then record headings as needed.
- Respect `prefers-reduced-motion`; transitions are limited to color/border/opacity and do not shift layout.
- After a legacy redirect or direct `focus` deep link, retain the existing focused/highlighted record behavior.

## Minimal implementation shape

1. Add a thin `AdvanceWorkspacePage` route entry that owns the page header, `view` query state, workspace links, and optional governance link.
2. Extract the current bodies into feature-local `AdvanceRequestsPanel` and `AdvanceSettlementsPanel`, or add an `embedded` composition mode to the existing pages. Do not duplicate hooks or list markup.
3. Keep existing request and settlement hooks/mutations untouched.
4. Route `/advances` to the workspace. Redirect `/admin/advance-settlements` to `?view=settlements` while preserving `focus`.
5. Replace the two financial sidebar items with one `Tạm ứng & hoàn ứng` item. Rename the governance item to `Trung tâm phê duyệt`.
6. Update `PAGE_CATALOG`, `routes`, and `titleRules` together so sidebar, document title, agent search, and canonical paths do not drift. Governance should join the shared catalog rather than remain hard-coded.
7. Consolidate page-local duplicated `adv-*`/`as-*` shell, KPI, view-nav, responsive-filter, and empty-state CSS into one workspace stylesheet. Keep record-specific request/settlement selectors local.
8. Keep existing design tokens and font stack. No new dependency, icon library, global theme, or design-system migration.

The existing source already has the right compact data patterns; the intended change is shared hierarchy and clearer language. Avoid introducing nested cards, a new dashboard, decorative illustrations above live data, large hero metrics, gradients, or unrelated layout changes.

## Implementation cautions and tests

- `AdminAdvanceSettlementsPage` exposes an `Đã hoàn tác` filter. Preserve it and ensure `REVERSED` is initialized in derived counts during extraction so its count remains numeric.
- Preserve `focus=...` on both views and settlement/trip detail links.
- Verify view state survives refresh, back/forward, and copied URLs.
- Verify each role at 1440, 1024, 768, 390, and 320px.
- Assert `document.documentElement.scrollWidth === window.innerWidth` at 1024, 768, 390, and 320px.
- Keyboard pass: skip link, workspace links, KPI filters, status filter/select, record links, reason field, submission buttons, governance decision controls.
- Copy contract test: operational workspace contains `Gửi đề nghị…`; only governance contains the unqualified final action `Phê duyệt`.
- Regression tests cover all current filters/statuses, counts, proposal payloads, detail navigation, read-only role rendering, loading/error/empty states, and legacy redirect.

## Scope boundary

No API/DB/RBAC changes. No new approval state. No change to financial totals, settlement grouping, optimistic concurrency/version payloads, or governance mutation behavior. No redesign of the global shell or unrelated financial pages.

