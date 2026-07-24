# Plan — "Xe ngoài" (external-carrier) badge on Customer pages

**Status:** `pending approval` (RALPLAN consensus — Planner draft revised per Architect `SOUND-WITH-CONDITIONS`; pending Critic review)

**Architect conditions — RESOLVED in revision:**
1. ✅ Badge color **pinned** to info-blue `#1d4ed8/#dbeafe/#bfdbfe` (distinct from "2 chiều" green); hard-coded-triplet debt acknowledged with a `// TODO: extract <Badge>` comment.
2. ✅ Detail-page badge placement is **definitive** — inline after `<h1>` only; `dd-sub`/`dd-tag` lane explicitly rejected as a category error.
3. ✅ "Khách hàng doanh nghiệp" descriptor decision taken — **unchanged**, with rationale (no badge/descriptor redundancy).
4. ✅ (non-blocking) No `?? false` at call site — column is `NOT NULL`; `?:` kept on type only for backwards-compat.

**Request:** When a customer is flagged `isCarrier` (đối tác vận tải xe ngoài), show a badge on the customer detail page (`/customers/:id`) and the customer list page (`/customers`).

---

## 1. Findings (verified from source)

### Data model
- `customers.is_carrier` — `boolean, NOT NULL, default false` (`backend/src/db/schema.ts:156`).
- `Customer.isCarrier: boolean` — shared type (`shared/src/types/index.ts:65`). **Already present on every Customer object.**
- The create/edit form already sets it; the checkbox label is literally **"Đối tác vận tải (xe ngoài)"** (`frontend/src/pages/CustomersPage.tsx:153`).
- Already consumed as a filter elsewhere: `TripEditPage.tsx:37`, `DispatchPage.tsx:32`, `useTripDetailPage.ts:385` (`customers.filter(c => c.isCarrier)`).

### Pages
| Route | Component | Name render location | `isCarrier` available? |
|-------|-----------|----------------------|------------------------|
| `/customers` (list) | `CustomersPage.tsx` | mobile card line ~411; desktop row line ~510 | ✅ yes — `c.isCarrier` per row |
| `/customers/:id` (detail) | `DebtDetailPage.tsx` (App.tsx:138 maps the route here) | `<h1>{customer.name}</h1>` line 254; descriptor in `dd-sub` lines 255–271 | ❌ no — statement payload omits it |

### Detail-page data path (the one gap)
- `useCustomerStatement(id)` → `getCustomerStatement(id)` → `FINANCIAL.CUSTOMER_STATEMENT(id)` → backend `getStatementData()` (`backend/src/services/statement.service.ts:93`).
- Line 94: `db.select().from(s.customers).where(eq(s.customers.id, customerId))` — **selects the FULL customer row, so `customer.isCarrier` is already in memory**; it is simply not copied into the returned object.
- Line 211: `customer: { id, name, contactInfo, debitNoteMode }` — the only place `isCarrier` needs to be added.
- `CustomerStatementData.customer` type (line 16) and `CustomerStatement.customer` Pick (`shared/src/types/index.ts:928`) currently: `{ id, name, contactInfo } & { debitNoteMode? }`.

### Badge precedents
- **List-page "2 chiều" badge** (`linkedSupplierId`): inline `<span>` with color/bg/border/radius/padding — mobile `CustomersPage.tsx:412–416`, desktop `512–516`. This is the exact pattern to mirror.
- **"Xe ngoài" is the established short label** app-wide: `TripInfoCard.tsx:108`, `ExternalCarrierCard.tsx:23` (with `Truck` icon), `tripColumns.tsx:73/79`, `TripMobileCard.tsx:58`, `ReassignDialog.tsx:38/83`.
- Detail-page debt tags: `dd-tag dd-tag--warn/--ok dd-tag--dot` in `dd-sub` (`DebtDetailPage.tsx:266–270`).

---

## 2. RALPLAN-DR summary

### Principles
1. **Surgical** — reuse the existing `isCarrier` field and existing badge patterns; touch the minimum surface.
2. **One source of truth** — `customers.is_carrier` is the flag; never infer carrier-ness from trips or naming.
3. **Consistency** — identical badge label ("Xe ngoài") and tone across list + detail + the rest of the app.
4. **No wasted round-trips** — prefer extending an existing payload over adding an HTTP call.
5. **Conditional-only display** — badge appears iff `isCarrier === true`; non-carriers are visually unchanged.

### Decision Drivers (top 3)
1. **The list page needs zero data work** (`c.isCarrier` already on the row) — it is a pure UI add.
2. **The detail page's statement payload already loads the flag** (full-row SELECT) but doesn't expose it — exposing it is a one-liner, no new query.
3. **Label/color consistency** with the "2 chiều" badge and the app-wide "Xe ngoài" label.

### Viable options

**Option A — Extend the statement payload (RECOMMENDED).**
- Backend: add `isCarrier: customer.isCarrier` at `statement.service.ts:211`; add `isCarrier?: boolean` to `CustomerStatementData.customer` (line 16).
- Shared: add `isCarrier?: boolean` to `CustomerStatement.customer` Pick (`shared/src/types/index.ts:928`).
- Frontend detail: read `customer.isCarrier`, render badge in header.
- **Pros:** zero extra queries/HTTP; coherent data shape; single backend source; trivially backwards-compatible (optional field).
- **Cons:** touches 3 layers (backend + shared + frontend); statement payload gains an operational flag (minor — header is already denormalized).

**Option B — Separate `GET /customers/:id` on the detail page (frontend-only).**
- Add a `useQuery` on `DebtDetailPage` calling the existing CRUD `GET /api/customers/:id` (returns full row incl. `isCarrier`).
- **Pros:** no backend/shared change; fully isolated to one file.
- **Cons:** extra network request per detail view; two sources of customer truth on one page; the row is already loaded by the statement — wasteful and slightly incoherent.

**Option C — Read from a customer cache (`useCustomers`/aging) like the page already does for `linkedSupplierId` via `dual-entities`.**
- **Pros:** no new fetch if cached.
- **Cons:** paginated cache is unreliable (the customer may not be on the current page) → flaky badge. Rejected: correctness over cleverness.

**Why A over B:** the flag is already fetched in the exact query the detail page depends on; exposing it is smaller *and* more correct than a redundant call. Option B's "one-file" appeal does not outweigh the wasted round-trip and dual-truth smell. Option C fails on reliability.

### (Deliberate mode not triggered)
Low risk: additive, optional, boolean, display-only. No auth/security, no migration, no destructive change, no public-API breakage (the new field is additive). Pre-mortem and expanded test matrix skipped per short-mode default.

---

## 3. Implementation steps

### Step 1 — Shared type (additive, optional)
`shared/src/types/index.ts:928` — extend the `CustomerStatement.customer` Pick:
```ts
export interface CustomerStatement {
  customer: Pick<Customer, 'id' | 'name' | 'contactInfo' | 'isCarrier'> & { debitNoteMode?: string | null };
  // ...rest unchanged
}
```

### Step 2 — Backend statement payload
`backend/src/services/statement.service.ts`:
- Line 16 — `CustomerStatementData.customer`: add `isCarrier?: boolean`.
- Line 211 — add `isCarrier: customer.isCarrier` to the returned `customer` object.
(No query change — line 94 already selects the full row.)

### Step 3 — List page badge (`CustomersPage.tsx`) — `c.isCarrier` already present
Add an **"Xe ngoài"** badge next to the customer name, mirroring the existing "2 chiều" inline-`<span>` pattern, in **both** views:
- Mobile card (`~412–416`): after the name span, inside `.m-card__title`.
- Desktop row (`~512–516`): after the name span, inside the name flex container.

**Color decision (pinned — resolves Architect Condition 1):** use an **info-blue** triplet distinct from the "2 chiều" green (`#16a34a`/`#dcfce7`/`#bbf7d0`, hard-coded at `CustomersPage.tsx:413,513`):
- text `#1d4ed8` · bg `#dbeafe` · border `#bfdbfe`
- Same compact inline-span shape (fontSize 10, fontWeight 700, radius 4, padding `1px 5px`, letterSpacing `0.02em`) as "2 chiều".
- Prepend a `Truck` icon (already used app-wide in `ExternalCarrierCard.tsx:23`) for label/icon consistency.
- Both badges render together without overlap when a customer is both `linkedSupplierId` and `isCarrier` (flex-wrap is already set on the name container).
- **Debt acknowledged:** this is a *third* hard-coded color triplet in the file. It is a deliberate choice (surgical, matches the proven local pattern) over scope-creep. Add a `// TODO: extract a shared <Badge> component for "2 chiều" / "Xe ngoài"` comment at the first occurrence so the debt is tracked, not lost.

### Step 4 — Detail page badge (`DebtDetailPage.tsx`) — inline after H1 ONLY
Render the badge **only inline, immediately after `<h1>{customer.name}</h1>`** (line 254), using the same "Xe ngoài" label + info-blue tone as Step 3. This matches the list-page "badge beside name" convention.

**Placement is definitive (resolves Architect Condition 2):** do **NOT** use the `dd-sub` / `dd-tag` lane (lines 255–271). That lane carries *financial-status* signals ("Còn nợ trong hạn" / "Đã thanh toán đủ"); "Xe ngoài" is an entity-class attribute, not a financial state — placing it there is a category error, not a stylistic option.

**Descriptor decision (resolves Architect Condition 3):** keep the `dd-sub` descriptor **"Khách hàng doanh nghiệp"** (line 264) **unchanged**. Rationale: a carrier partner is still a business customer record in the `customers` table; "Khách hàng doanh nghiệp" is the general entity-class label and the inline "Xe ngoài" badge is the precise differentiator. No conditional re-labelling — avoids redundancy between badge and descriptor. (If product later wants the descriptor itself to read "Đối tác vận tải", that is a one-line follow-up, not part of this change.)

**Type usage note (Architect non-blocking):** `customers.is_carrier` is `NOT NULL` (`schema.ts:156`), so at the call site use `customer.isCarrier` directly — **no `?? false` defensive coalescing**. The `?:` on the new type is kept only for backwards-compat with older cached payloads, not because null is possible at runtime.

### Step 5 — (Optional, out of scope unless requested)
Filter pill "Xe ngoài · N" on the list toolbar, and an Excel-export column. **Not included** — request was display-only. Flagged so it is a conscious omission, not an oversight.

---

## 4. Acceptance criteria
1. A customer with `is_carrier = true` (e.g. id 9 if so flagged) shows the "Xe ngoài" badge on `/customers` (both mobile ≤640px and desktop >640px) and on `/customers/:id`.
2. A customer with `is_carrier = false` shows **no** badge and is otherwise visually identical to today.
3. The "2 chiều" badge (when a customer also has `linkedSupplierId`) and the "Xe ngoài" badge render together without overlap/clipping.
4. Badge label is exactly "Xe ngoài" (matches TripInfoCard / ExternalCarrierCard / tripColumns).
5. `tsc --noEmit` passes for backend, frontend, and shared (3-command CI check).

### Verification
- Visual: open `/customers` and `/customers/9` in browser; confirm badge presence/absence for a carrier and a non-carrier; check both breakpoints.
- Type: run the 3 `tsc --noEmit` commands.
- Network: confirm the detail page makes **no new** request (Option A) — the statement call already carries `isCarrier`.

---

## 5. Risk & rollback
- **Risk:** very low — additive optional boolean, display-only.
- **Rollback:** revert the 4-file diff (shared type, statement.service.ts, CustomersPage.tsx, DebtDetailPage.tsx). No DB migration involved.

---

## 6. ADR
- **Decision:** Add an "Xe ngoài" badge (when `isCarrier`) to the customer list and detail pages; expose `isCarrier` via the existing statement payload (Option A).
- **Drivers:** flag already on Customer rows; statement query already loads it; "Xe ngoài" is the app-wide label; list-page "2 chiều" badge is the proven pattern.
- **Alternatives considered:** separate `GET /customers/:id` (B — redundant call, dual truth); cache-read (C — unreliable). 
- **Why chosen:** smallest correct change; no extra queries; coherent single source of truth.
- **Consequences:** statement payload gains one optional boolean field (additive, non-breaking).
- **Follow-ups:** optional "Xe ngoài" filter pill + export column (Step 5) if product wants it later.

---

## 7. Critic nits (non-blocking — folded in for executability; APPROVE verdict unchanged)

1. **`/debt/:id` inherits the badge (intentional).** Both `/debt/:id` (App.tsx:131) and `/customers/:id` (App.tsx:138) render `DebtDetailPage`, so a carrier customer's badge also shows on its debt-detail view. This is desired (consistency principle) and harmless — called out here so it's a conscious decision, not an omission.
2. **Detail-page H1 is block-level** (inside `.dd-meta`, DebtDetailPage.tsx:254). A naive `<span>` after the `<h1>` wraps to a new line. Executor must either (a) add `{' '}` + `display:'inline'` on the badge span, or (b) wrap `<h1>`+badge in a `display:'flex'; gap:8; align-items:center; flex-wrap:wrap` container. Pick (b) for robustness.
3. **Exact type-gate commands** (AC #5): `cd shared && npm run typecheck` · `cd backend && npx tsc --noEmit` · `cd frontend && npx tsc --noEmit`. (Per `shared-tests-tsc-blindspot` memory, shared test files are intentionally excluded from tsc.)
4. **a11y + per-view mirroring:** the `Truck` icon must be `aria-hidden` (the adjacent "Xe ngoài" text is the label) — mirror `ExternalCarrierCard.tsx:23`. The two existing "2 chiều" spans differ slightly (mobile uses `verticalAlign:'middle'` at :413; desktop uses `marginTop:1` at :513) — mirror each view's local variant for the new badge.

**Blast-radius note (informational):** `data.customer` is also read by `exportStatementXlsx`/`exportStatementHtml` (statement.service.ts:229,242), `debitNote.service.ts`, and `ledger.routes.ts`. They read only `.name`, so the additive `isCarrier` field is harmless to all exporters.
