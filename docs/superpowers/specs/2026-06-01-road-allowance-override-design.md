# Road Allowance Override + Validation Fix + Error Surfacing

**Date:** 2026-06-01
**Status:** Approved

## Context

Ngọc Ánh (accountant) reported two issues:
1. "Dữ liệu không hợp lệ" errors when creating/editing trips
2. Inability to adjust "Tiền đi đường" (road allowance) when the computed total doesn't match reality

Investigation revealed the validation error is caused by `tripLegSchema.km` using `positiveNumeric` (rejects 0), not a revenue issue. Road allowance is currently computed-only with no override mechanism.

## Acknowledged (No Changes Needed)

**Revenue split is already shipped.** Two revenue fields exist in AllowanceSection:
- **DT trả hàng** (`revenueEmptyReturn`) — with "Giá gợi ý" price hint from pricing table
- **DT kết hợp đóng hàng** (`revenueCombine`) — manual input

Both auto-sum to `revenue` via `useTripForm.ts`. DB columns (`revenue_empty_return`, `revenue_combine`) exist. No changes required.

## Changes

### 1. Loosen tripLegSchema.km — Fix "Dữ liệu không hợp lệ"

**Problem:** `positiveNumeric` rejects `km = 0`, causing generic Zod errors for incomplete/placeholder legs.

**Fix:** Change `km: positiveNumeric` → `km: nonNegNumeric` in `shared/src/schemas/index.ts:52`.

The `nonNegNumeric` helper already exists in the same file. Allows 0, rejects negatives.

### 2. Add roadAllowanceOverride — Editable Override

**Problem:** "Tiền đi đường" is computed from `roadAllowanceBase - tollsDiscount + tollsAddition - (tollsStations × tollPerStation) + returnCargoBonus`. Accountant cannot override when reality differs.

**Solution:** New nullable column + override branch in calculation.

**DB:**
- Add `roadAllowanceOverride: numeric('road_allowance_override', { precision: 15, scale: 0 })` to trips table
- Nullable — null means "use computed value"
- Migration: `drizzle-kit generate` + `drizzle-kit migrate` (zero-downtime, no backfill)

**Calculation** (`shared/src/calculations/tripTotals.ts`):
```ts
const totalRoadAllowance =
  input.roadAllowanceOverride != null && input.roadAllowanceOverride > 0
    ? input.roadAllowanceOverride
    : Math.max(0, rawRoadAllowance);
```

**Shared types:** Add `roadAllowanceOverride?: number | null` to Trip interface.

**Zod schema:** Add `roadAllowanceOverride: nonNegNumeric.optional()` to trip create/update schemas.

**Backend service:** Include field in insert/update/select.

**UI** (`AllowanceSection.tsx`):
- New input: "Điều chỉnh tiền đi đường (VNĐ)"
- Read-only text below: "Tự tính: {computedTotal} VNĐ" — so accountant can compare
- When non-empty, override value replaces computed total
- Clearing the field = null in DB = revert to computed

### 3. Better Zod Error Surfacing

**Problem:** Zod failures return `"Dữ liệu không hợp lệ"` as the primary error message, even though `details` array contains field-level messages.

**Current backend** (`errorHandler.ts`):
```ts
res.status(400).json({ error: 'Dữ liệu không hợp lệ', details: err.errors });
```
Backend already returns field details. Issue is likely in the **frontend** not extracting them.

**Fix:** Check `tripClient.ts` error handling — ensure it extracts `details[0].message` (field-level) over the generic `error` string when available.

## Files to Modify

| File | Change |
|------|--------|
| `shared/src/schemas/index.ts` | km → nonNegNumeric; add roadAllowanceOverride |
| `shared/src/types/trip.ts` | Add roadAllowanceOverride to Trip type |
| `shared/src/calculations/tripTotals.ts` | Override branch for totalRoadAllowance |
| `backend/src/db/schema.ts` | Add roadAllowanceOverride column |
| `backend/src/db/migrations/` | Generated migration |
| `backend/src/services/trip.service.ts` | Persist & select override |
| `frontend/src/api/tripClient.ts` | Surface field-level Zod errors |
| `frontend/src/hooks/useTripForm.ts` | Wire override state |
| `frontend/src/components/trip/AllowanceSection.tsx` | Override input + computed display |

## Verification

1. **Unit tests:** `vitest` in shared/ — verify `computeTripTotals` returns override when set, computed when null
2. **Validation:** POST trip with leg `km: 0` → should succeed
3. **Integration:** Create trip with `roadAllowanceOverride` → verify persisted → verify TotalsPanel shows override
4. **Error surfacing:** POST invalid trip → verify frontend shows field-specific message
5. **Manual:** Login as accountant → edit trip → set override → total updates → clear → reverts to computed
