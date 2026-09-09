# QA Evidence — Trilogy gap F7 / MDN-7: inactive factory hidden from CUS create dropdown

**Date:** 2026-09-10
**Lane:** fullstack (cross-cutting QA verification)
**Issue:** MasterDataNhaMay.md §3.3 — nhà máy bị vô hiệu hoá (`is_active = false`) không được xuất hiện trong dropdown tạo lô.
**Previous state:** PARTIAL evidence-only (F7) — previous pass couldn't locate the `isActive` filter.
**Outcome:** **COVERED** — filter found + explicit regression test added.

## 1. Filter verification (read-only pass)

| Layer | File:line | Evidence |
|---|---|---|
| Backend service | `backend/src/services/shipment-intake.service.ts:289` | `eq(s.operationalSites.isActive, true)` trong WHERE clause của `listOperationalSitesForIntake` |
| Backend route | `backend/src/routes/shipments/core.routes.ts:401-414` | `GET /api/shipments/operational-sites` gọi `listOperationalSitesForIntake(customerId, actor)` → chỉ trả active rows |
| Admin endpoint (separate intent) | `backend/src/routes/shipments/core.routes.ts:430-436` | `GET /api/shipments/operational-sites/admin` gọi `listOperationalSitesForAdmin` → trả cả deactivated rows (để admin re-enable) |
| Frontend query | `frontend/src/api/shipmentClient.ts:717-723` | `listOperationalSites(customerId)` gọi endpoint trên, không filter thêm (đã được backend filter) |
| Frontend derivation | `frontend/src/features/shipments/create/ShipmentCreateWorkspace.tsx:182` | `operationalSites = sites.filter(site.siteType === 'FACTORY')` — chỉ chọn FACTORY type (đã active từ backend) |

**Conclusion:** filter chain end-to-end đúng. Backend là canonical; frontend tin tưởng backend response.

## 2. Regression test (new)

**File:** `backend/src/tests/shipment-intake-submit.test.ts`
**Test name:** `MDN-7: hides inactive factories from intake listing (trilogy F7)`
**Pattern:** integration test (uses real test DB)

### Setup
- Tạo 1 customer + 1 route + 1 active FACTORY (qua `references()` helper)
- Tạo thêm 1 FACTORY thứ 2 cùng customer, set `isActive = false`

### Assertions
1. Active factory (từ `references()`) **xuất hiện** trong `listOperationalSitesForIntake(customerId, CUS)`.
2. Inactive factory **không xuất hiện** trong cùng listing.
3. Admin endpoint `listOperationalSitesForAdmin(ADMIN)` **vẫn thấy** inactive factory với `isActive === false` (để admin re-enable).

### Run command
```
cd backend
DATABASE_URL=postgres://postgres:postgres@localhost:5441/silversea \
  npx tsx --test --test-concurrency=1 --test-name-pattern="MDN-7" \
  'src/tests/shipment-intake-submit.test.ts'
```

### Output
```
▶ operational site admin maintenance
  ✔ MDN-7: hides inactive factories from intake listing (trilogy F7) (81.127959ms)
✔ operational site admin maintenance (81.591042ms)
ℹ tests 1
ℹ suites 1
ℹ pass 1
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 797.671458
```

**Exit status:** 0. **Pass.** 81ms.

## 3. Files changed

| File | Change |
|---|---|
| `backend/src/tests/shipment-intake-submit.test.ts` | +36 lines: new test `MDN-7` (hides inactive factories from intake listing). Uses existing helpers (`actor`, `references`); adds 1 extra insert for inactive factory. |
| `testplan/matrix/2026-09-09-docx-trilogy.md` | row 7 (§2 MasterDataNhaMay) PARTIAL → COVERED with evidence; F7 finding CLOSED; §6 phase-2 checklist updated; §8 Summary table: MasterDataNhaMay 11→12 COVERED, 3→2 PARTIAL; total 56→57 COVERED, 9→8 PARTIAL; PARTIAL list updated from 3→2 items with explicit "F7 closed 10/09" pointer. |

## 4. Ratchet / forward discipline

- **Trunk-based:** both files committed directly to `main`. No branches.
- **Pre-commit hook:** backend typecheck passes (file added is in `backend/src/tests/*.test.ts` which is part of typecheck surface).
- **Shared tree:** no other lane's files touched. Working tree contains 3 foreign files (left alone): `shared/src/calculations/fuelSurcharge.test.ts` (QA test-first T6), `backend/check-cleanup.ts` (cleanup script), `backend/src/tests/freight-pricing-engine.test.ts` (QA test-first T6).
- **Permissions:** integration test passes against the silversea test DB on port 5441; uses `references()` suffix pattern for isolation; `after` hook cleans up all created rows.

## 5. Next / Phase-2

- F7 closed. Row 7 = COVERED.
- 2 remaining PARTIAL of wave cũ: F5 (nhãn "Chạy ngoài") + F6 (snapshot khi phát lệnh) — both await user/customer decisions (no code action).
- Wave auto-pricing rows added §7 are still PARTIAL/BLOCKED pending T1/T2/T6 — unrelated to F7.
