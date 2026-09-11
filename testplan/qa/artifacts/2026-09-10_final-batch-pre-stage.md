# Final batch PRE-STAGE — for STAGING READY 1D

**Status:** Pre-staged. Awaiting STAGING READY 1D signal (architect-approved vehicle-list fix in staging re-cut).

## Plan (single eval when triggered)

### Step 1 — fresh login dungnv + open plan editor
1. Clear `localStorage` + `sessionStorage` via `browser_evaluate`.
2. Navigate to `https://vantai.tingting.vip/login`.
3. Login as `dungnv` / `Abc123` → redirects to `/dispatch`.
4. Navigate to `https://vantai.tingting.vip/dispatch-detail`.

### Step 2 — TC-DDP-003 save-cycle (non-issued row → SilverSea → save)
1. Click `.dispatch-assignment-cell__trigger` on row 1 (UNASSIGNED, no quick-issue; current shipment code = EHPH26080202).
2. Dialog "Chỉnh sửa điều phối · EHPH26080202" should open with all fields (Nhà xe / Xe biển số / Phân loại / Cước thu / Cước trả / Ghi chú tác vụ / + Thêm tag / Ghi chú thêm / Hiển thị / Hủy / Lưu thay đổi).
3. Click **Nhà xe** button (currently showing "HÀ AN") → searchable-select opens → select **"SilverSea — xe nội bộ"**.
4. Click **Xe / biển số** button (id="dispatch-vehicle-13") → searchable-select opens with SilverSea's trucks (per fix). Pick a plate (the first one in the list).
5. Toggle 2 tags: click button for **ĐẶT ĐẦU**, then click button for **ĐẢO VỎ** (or per multi-select behavior — may need to handle the "Tất cả" master toggle).
6. Append free text to notes textarea: existing value + " QA-FREE-TEXT-NOTE".
7. Click **"Lưu thay đổi"** (Save changes).
8. **Assert**: success toast appears (look for `[role=alert]` or `[class*=toast]`); row 1 transitions from UNASSIGNED to ASSIGNED/ISSUED; the carrier column updates from "HÀ AN" to "SilverSea" and the plate column shows the selected plate.

### Step 3 — Issue to laixe
After the save cycle commits, the row should have a fulfillment. Re-open the same row's plan editor. Verify the "Nhà xe" is SilverSea and a driver field appears or a separate "Phát lệnh cho tài xế" button surfaces.
- If the driver is auto-assigned: capture the assignment; move to Step 4.
- If the driver field is exposed: select **"laixe" / "Phạm Văn Hùng" / plate 15C-284.56** from the driver searchable-select. If `laixe` doesn't appear as a driver option (because the testplan marked `laixe` as local-dev-only and `thu` failed on staging), fall back to a staging DRIVER account (e.g., `bqhuong` / 15H-061.14).
- Save again. Assert success toast + row state transition.

### Step 4 — Login as laixe (or fallback DRIVER) → /my-trips
1. Clear session + login as the same DRIVER used in Step 3.
2. Navigate to `/my-trips`.

### Step 5 — TC-DRV-MOBILE-001..007 + TC-REPLACE-TAGS-002
Run per `testplan/qa/2026-09-10_driver-mobile-ui.md`:
- **TC-DRV-MOBILE-001**: field order at 390px — verify labels in order Nhà máy, Tuyến, Container / lô hàng, Cảng nâng / Cảng hạ, Tác vụ, Người liên hệ, Đầu kéo / Mooc, Footer CTA.
- **TC-DRV-MOBILE-002**: no horizontal scroll at 360 / 390 / 768.
- **TC-DRV-MOBILE-003**: container + ports side-by-side (assert bounding rect pairing).
- **TC-DRV-MOBILE-004**: 390px screenshot as canonical reference.
- **TC-DRV-MOBILE-005**: DRV-LIST-01 + DRV-LIST-04 still hold.
- **TC-DRV-MOBILE-006**: Vietnamese labels match approved terminology.
- **TC-DRV-MOBILE-007**: long factory name abbreviates without breaking layout.
- **TC-REPLACE-TAGS-002**: assert the 14 canonical tags appear in displayOrder on the journey card.

### Step 6 — Report
- Per-TC PASS/FAIL with artifacts (saved to `testplan/qa/artifacts/`).
- Immediate FAILs per standing rule.
- `team_complete_step` with `qaPassed: true` ONLY if every TC holds.

## Pre-emptive risks / contingencies
- **Save flow changed by architect** — re-read dialog state on arrival, don't assume prior behavior. The fix may have introduced new fields or moved buttons.
- **Plate listbox may have multiple SilverSea trucks** — pick the first one; document which one was used.
- **Multi-select tag picker behavior is non-trivial** — clicking the 2nd tag may toggle the 1st off. May need to use the "Tất cả" master toggle or click in a specific order. Document any quirks.
- **`laixe` may not exist on staging** (testplan: local-dev-only). Fallback to a staging DRIVER (`bqhuong`, `vvtrung`, `tvtham`, `btdung` — all verified to login earlier; plates differ).
- **Browser MCP screenshot still fails** — text/DOM evidence only; cite URL + captured text in `ui-driver.log`.
- **Browser MCP clone error** on async fetch responses — return `String(r.status)` only, not the full response object.

## Artifacts to produce
- `testplan/qa/artifacts/2026-09-10_driver-mobile-ui_final-cycle.md` — TC-DRV-MOBILE-001..007 + TC-REPLACE-TAGS-002 verdicts.
- `testplan/qa/artifacts/2026-09-10_tddp003_save-final.md` — TC-DDP-003 verdict.
- `testplan/qa/artifacts/2026-09-10_final-batch.log` — per-step execution log.

## What to skip if blocked
- If SilverSea plate listbox STILL empty in 1d → re-escalate as defect; file as fullstack regression; abort the rest of the batch.
- If T3 fixture creation still fails → defer TC-DRV-MOBILE-001..007 + TC-REPLACE-TAGS-002 (cycle-2 unit-test green on 9b2744b6 stays as rung-1 backup).
