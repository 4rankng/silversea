# case-QA-2026-09-27-03 — Trang quản lý xe ngoài /fleet/external (card 20260927_66)

## Contract
- Route `/fleet/external` reachable by DISPATCHER (dungnv) and ADMIN (admin); CUS (thanhdc) and FORWARDER are redirected/refused.
- Union list shows: (B) all `carrier_fleet_vehicles` rows with carrier name + active state; (A) trucks with `carrier_id` marked "liên kết nhà thầu", tombstoned A rows visibly marked.
- DISPATCHER can register a new external plate (POST /api/shipments/carrier-fleet-vehicles — RBAC widened) and toggle isActive (PATCH). CUS still gets 403 on both.
- Plate search normalizes separators (15E-016.26 ≡ 15E01626).
- No hard delete anywhere on the page.

## Repro (after staging cut)
1. Login dungnv/Abc123 → Điều vận nav → "Xe ngoài" → /fleet/external renders union list.
2. Type a new plate + pick carrier → "Thêm xe" → row appears, isActive=true; picker on /dispatch-detail now offers it.
3. Toggle "Ngưng hoạt động" on the row → PATCH isActive=false; resolve-carrier for that plate resolves nulls.
4. Login thanhdc → attempt POST via API → 403.

## Expected
All four steps behave as stated; regression protects the dieuvan-manages-external-trucks loop end to end.
