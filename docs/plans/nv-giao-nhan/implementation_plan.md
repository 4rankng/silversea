# Implement Forwarder (Nhân viên giao nhận) Role

> **For agentic workers:** Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a FORWARDER role that can manage container/seal numbers on trips, record operational expenses (nâng hạ, hải quan, cân xe, kiểm tra), and submit advance payment requests with approval workflows.

**Architecture:** Three-phase rollout. Phase 1 adds core entities + forwarder portal (containers, expenses). Phase 2 adds advance requests with ledger posting. Phase 3 adds settlements (1:N with advances) with full ledger reconciliation. Forwarder is identified directly by `user.id` (no separate table) — like the driver portal pattern.

**Tech Stack:** Drizzle ORM (PostgreSQL), Express v5, Casbin RBAC, Zod schemas, React 18, TanStack Query, TanStack Table

---

## Resolved Business Questions

1. **Ledger impact**: Forwarder is the entity. Advance approval → `postEntry({ entityType: 'FORWARDER', credit: amount })` creates liability. Settlement approval → clears liability.
2. **Settlement coverage**: 1 Settlement can cover N Advance Requests (via junction table `advance_settlement_requests`).
3. **Expense Types**: 4 predefined (`LIFTING`, `CUSTOMS`, `WEIGHING`, `INSPECTION`) + `OTHER` catch-all.

---

## Database Changes

> **Migration required:** `drizzle-kit generate` + `drizzle-kit migrate`

### New Enums

| Enum | Values |
|------|--------|
| `role` (ALTER) | Add `FORWARDER` |
| `txn_type` (ALTER) | Add `FORWARDER_ADVANCE`, `FORWARDER_SETTLEMENT` |
| `forwarder_expense_type` (NEW) | `LIFTING`, `CUSTOMS`, `WEIGHING`, `INSPECTION`, `OTHER` |
| `advance_request_status` (NEW) | `PENDING`, `APPROVED`, `REJECTED` |
| `advance_settlement_status` (NEW) | `PENDING`, `CHECKED_BY_ACCOUNTANT`, `APPROVED`, `REJECTED` |

### New Tables

| Table | Key Fields | Notes |
|-------|-----------|-------|
| `trip_containers` | `trip_id`, `container_number`, `seal_number`, `notes` | Số cont/seal per trip |
| `trip_expenses` | `trip_id`, `forwarder_id`, `expense_type`, `amount`, `note` | Chi phí phát sinh, indexed on `trip_id` |
| `advance_requests` | `requester_id`, `amount`, `reason`, `status`, `approved_by`, `approved_at` | Tạm ứng |
| `advance_settlements` | `total_expense_amount`, `refund_amount`, `status`, `checked_by`, `approved_by` | Thanh toán tất toán |
| `advance_settlement_requests` | `settlement_id`, `advance_request_id` | Junction table (1:N), unique index |

---

## Casbin Policy (FORWARDER)

```csv
p, FORWARDER, forwarder_portal, read
p, FORWARDER, forwarder_portal, write
p, FORWARDER, maps, read
p, FORWARDER, photos, read
```

Follows DRIVER portal pattern. Admin-side forwarder routes mount under `financial` resource (already authorized for MANAGER/ACCOUNTANT).

---

## API Endpoints

### Forwarder Portal (`/api/forwarder/me`)

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/trips` | List all trips (no financial fields) |
| `GET` | `/trips/:id` | Trip detail + containers + own expenses |
| `POST` | `/trips/:tripId/containers` | Add container/seal |
| `POST` | `/expenses` | Record expense |
| `DELETE` | `/expenses/:id` | Delete own expense (ownership check) |

### Admin Forwarder (`/api/forwarder-expenses`, under `financial` Casbin resource)

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/` | List all forwarder expenses with filters |

### Phase 2 additions (outline)

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/forwarder/me/advance-requests` | Create advance request |
| `GET` | `/forwarder/me/advance-requests` | List own advance requests |
| `GET` | `/advance-requests` | Admin: list all requests |
| `POST` | `/advance-requests/:id/approve` | Admin: approve + ledger posting |
| `POST` | `/advance-requests/:id/reject` | Admin: reject |

### Phase 3 additions (outline)

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/forwarder/me/advance-settlements` | Create settlement (link N requests) |
| `GET` | `/advance-settlements` | Admin: list all settlements |
| `POST` | `/advance-settlements/:id/check` | Accountant: mark checked |
| `POST` | `/advance-settlements/:id/approve` | Director: approve + ledger reconcile |
| `POST` | `/advance-settlements/:id/reject` | Director: reject |

---

## Ledger Integration

**Sign convention** (same as Driver/Vendor): credit increases liability, debit decreases.

| Event | Entry | Effect |
|-------|-------|--------|
| Advance approved | `entityType: 'FORWARDER', credit: amount` | Increases forwarder liability |
| Settlement approved | `entityType: 'FORWARDER', debit: totalExpense` + `credit: refund` | Clears liability, records refund |

---

## Files Summary

### Shared Layer

| File | Action | Changes |
|------|--------|---------|
| `shared/src/constants/index.ts` | MODIFY | Role.FORWARDER, ForwarderExpenseType, AdvanceRequestStatus, AdvanceSettlementStatus, new TxnType values, labels |
| `shared/src/constants/api-paths.ts` | MODIFY | FORWARDER path constants |
| `shared/src/types/index.ts` | MODIFY | TripContainer, TripExpense, TripExpenseWithRefs, AdvanceRequest, AdvanceRequestWithRefs, AdvanceSettlement, AdvanceSettlementWithRefs |
| `shared/src/schemas/index.ts` | MODIFY | tripContainerSchema, tripExpenseSchema, createAdvanceRequestSchema, createAdvanceSettlementSchema + inferred types |
| `shared/src/index.ts` | MODIFY | Export all new enums, types, schemas |

### Backend

| File | Action | Changes |
|------|--------|---------|
| `backend/src/db/schema.ts` | MODIFY | roleEnum + txnTypeEnum alterations, 3 new pgEnums, 5 new tables |
| `backend/src/casbin/policy.csv` | MODIFY | FORWARDER policy lines |
| `backend/src/services/ledger.service.ts` | MODIFY | FORWARDER entity type (getEntityTypeKey=4, sign convention) |
| `backend/src/services/forwarder.service.ts` | CREATE | getForwarderByUserId, getForwarderTrips, getForwarderTripDetail, createTripExpense, deleteTripExpense, listTripExpenses |
| `backend/src/routes/forwarder.ts` | CREATE | Portal routes (trips, containers, expenses) |
| `backend/src/routes/forwarder-admin.ts` | CREATE | Admin expense listing |
| `backend/src/index.ts` | MODIFY | Mount `/api/forwarder/me` + `/api/forwarder-expenses` |
| `backend/src/seed.ts` | MODIFY | Add FORWARDER user: `giaonhan` / `admin123` |

### Frontend

| File | Action | Changes |
|------|--------|---------|
| `frontend/src/api/forwarderClient.ts` | CREATE | getTrips, getTripDetail, createContainer, createExpense, deleteExpense |
| `frontend/src/hooks/useForwarderQueries.ts` | CREATE | useForwarderTrips, useForwarderTripDetail, useCreateForwarderExpense, useDeleteForwarderExpense |
| `frontend/src/hooks/useQueries.ts` | MODIFY | Export forwarder hooks |
| `frontend/src/pages/ForwarderTripsPage.tsx` | CREATE | Card-list trip view (like DriverTripsPage) |
| `frontend/src/pages/ForwarderTripDetailPage.tsx` | CREATE | Trip detail + container form + expense form |
| `frontend/src/App.tsx` | MODIFY | `forwarderOnly` guard, lazy routes, root redirect |
| `frontend/src/components/Layout.tsx` | MODIFY | FORWARDER sidebar, page title |

### Documentation

| File | Action | Changes |
|------|--------|---------|
| `PRODUCT-SPECS.md` | MODIFY | §2 persona, §4.15 business rules, §5 Module 10 user stories, §6 tables #15-18 |
| `docs/flows/README.md` | MODIFY | Doc 13, 2 new routes, 5/5 roles, demo account |
| `docs/flows/00-OVERVIEW_VA_PHAN_QUYEN.md` | MODIFY | FORWARDER role, Casbin matrix, route guards, sidebar, permission tests |
| `docs/flows/13-GIAO_NHAN_VA_TAM_UNG.md` | CREATE | Full flow document (standard format) |

---

## Existing Code to Reuse

| Pattern | Reference File | What to Reuse |
|---------|---------------|---------------|
| Driver portal | `backend/src/routes/driver.ts` | Identity resolution, route structure |
| Driver service | `backend/src/services/driver.service.ts` | `getForwarderByUserId()` after `getDriverByUserId()` |
| Driver client | `frontend/src/api/driverClient.ts` | Client structure |
| Driver hooks | `frontend/src/hooks/useDriverQueries.ts` | Hook structure |
| Driver pages | `frontend/src/pages/DriverTripsPage.tsx` | Page layout |
| Expense service | `backend/src/services/expense.service.ts` | CRUD + ownership pattern |
| CRUD factory | `backend/src/routes/utils/crud-factory.ts` | For simple admin CRUD |
| Zod helpers | `shared/src/schemas/index.ts` | `positiveNumeric`, `nonNegNumeric` |
| UI components | `frontend/src/components/UI.tsx` | `PageHeader`, `Panel`, `Btn`, `StatusPill`, `Modal`, `FormGroup` |

---

## Verification Plan

### Automated

```bash
cd shared && npm run build
cd ../backend && npx tsc --noEmit
cd ../frontend && npx tsc --noEmit
```

### Manual (Phase 1)

1. **Forwarder login**: Login as `giaonhan` → redirect to `/my-forwarder-trips`
2. **Data restriction**: Trip list loads without `revenue`, `costs`, `profit` in API response
3. **Container entry**: Add container + seal number → verify saved
4. **Expense entry**: Select type + amount → verify saved → delete → verify removed
5. **Ownership**: Forwarder A cannot delete Forwarder B's expense → 403
6. **Admin view**: Login as admin → forwarder expenses visible via API

### Manual (Phase 2)

1. **Advance request**: Forwarder creates → status PENDING
2. **Approval**: Director approves → ledger entry created → status APPROVED
3. **Rejection**: Director rejects → status REJECTED, no ledger entry

### Manual (Phase 3)

1. **Settlement**: Forwarder links 2+ advance requests → submits
2. **Accountant check**: Marks CHECKED_BY_ACCOUNTANT
3. **Director approval**: Approves → ledger reconciliation clears liability
4. **Refund handling**: If advance > expenses → refund amount recorded
