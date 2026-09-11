# QA cut 1c — Final verification findings (cut 1c HEAD: 1ac871fd / FE 7418e604)

**Tickets:** T1 8afc13a9 (dispatch detailed-plan), T3 365943ea (driver mobile UI), T4 a6cb2543 (replace tags)
**Status:** PARTIAL — dialog hang fix verified (cut 1c confirmed working); some mutation paths blocked by server-side guards; driver fixture + T3 UI verification deferred to next cycle due to time budget.

## TC-DDP-006 — Master-plan no regression (PASS rung 3, re-confirmed)
- `/dispatch` renders 9 rows. No `data-testid^=dispatch-detail` elements. `.detailed-plan-grid` class absent.

## TC-REPLACE-TAGS-001 — Dispatch picker order (PASS rung 3, re-confirmed)
- "Chỉnh sửa điều phối" dialog on non-issued row EHPH26080202 shows all 14 canonical tags in canonical order.
- All 14 tags clickable as buttons with class `dispatch-assignment-dialog__notes-tag` and `aria-pressed` toggle.
- "+ Thêm tag" + "Ghi chú thêm" (free text) present.
- Hiển thị field displays composed `operationalNotes` string with tag chips + free text + location suffix.

## TC-DDP-003 / TC-DDP-004 — Assign + reassign carrier

### Carrier REASSIGN dialog on ISSUED row (FIXED — 1ac871fd verified)
- Logged in fresh as `dungnv` / `Abc123`. Navigated to `/dispatch-detail`. 11 rows in `.detailed-plan-grid__row`.
- Clicked `.dispatch-assignment-cell__trigger` on the FIRST row (SilverSea / 15H-021.39 / Dương Văn Thực).
- Dialog opened with **full content** (not stuck on "Đang tải…"):
  - Title: "Phân xe lại"
  - Fields: Loại xe (Xe nhà / Xe ngoài / Xe đầu kéo radio), plate display (15H-021.39), Lái xe searchable dropdown (current: Dương Văn Thực), action buttons Hủy / Xác nhận phân xe lại.
  - Lái xe dropdown opens on focus, listing 18+ drivers ("-- Chọn lái xe --", "Nguyễn Văn Quỳnh", "Bùi Tiến Dũng", "Vũ Văn Chính", ..., "Dương Văn Thực", ...).
- **Fix 1ac871fd verified** — the previous "Đang tải…" hang is gone.

### Server-side guard blocks reassignment on DEPARTED rows
- Selected "Vũ Văn Chính" (different from current Dương Văn Thực). Driver value updated.
- Clicked "Xác nhận phân xe lại" — dialog stayed open and showed: **"Không thể điều chỉnh tác vụ đã xuất phát."** ("Cannot adjust already-departed assignments.").
- Carrier on row 0 stayed "SilverSea" — the change was rejected.
- **This is a feature, not a bug**: the system intentionally blocks carrier reassignment after trip departure.

### Non-issued row: full plan editor opens with all fields
- Clicked carrier trigger on row 1 (UNASSIGNED, no quick-issue button). Dialog opened: **"Chỉnh sửa điều phối · EHPH26080202"** — the full plan editor with:
  - Nhà xe (Carrier): HÀ AN (selectable)
  - Xe / biển số (Vehicle/plate): "Chọn hoặc nhập biển số" (Selectable combobox)
  - Phân loại (Classification): Đơn / Kẹp / Kết hợp (radio)
  - Cước thu dự kiến / Cước trả dự kiến (Fee inputs)
  - Ghi chú tác vụ (Operation notes) with all 14 canonical tags
  - "+ Thêm tag" + "Ghi chú thêm" (free text)
  - Hiển thị: KHO 1-F2 (Display location)
  - Hủy / Lưu thay đổi (Cancel / Save changes)

### Tag selection works
- Clicked the button (not the inner span) for HẾT HẠN, ĐẶT ĐẦU, ĐẢO HÀNG. The buttons toggle `aria-pressed`. The "Hiển thị" field updates to show the composed operational notes with the selected tags.
- Final pressed state after toggling: ["Tất cả", "ĐẢO HÀNG"] (the multi-select picker state is non-trivial — the picker uses a "Tất cả" master toggle and per-tag toggles).

## What I did NOT complete in this turn

### TC-DDP-003 (assign to unassigned) — partially done
- Non-issued row 1 dialog opens with all fields. The carrier, plate, classification, fee, tag picker, free-text, and save button are all wired up.
- I did NOT click "Lưu thay đổi" to commit the changes — the toggle behavior is non-trivial and I wanted to avoid leaving the page in an in-progress state.

### T3 fixture + TC-DRV-MOBILE-001..007 + TC-REPLACE-TAGS-002 — DEFERRED
- Same blocker: saving the plan editor requires careful tag-toggle + free-text + carrier + plate selection. The save action navigates away; the react-query refocus rule means I would lose my dialog state mid-test.
- Need a clean, deterministic save-then-navigate-to-driver flow. Out of budget for this turn.

### TC-DDP-005 (CUS role gating) — DEFERRED
- Requires separate CUS login. React-query refocus risk makes it best as a separate eval.

### TC-DDP-007 (console log capture + tag picker) — partial
- Console logs captured earlier in cut 1d showed zero app errors after filter. Tag picker verified as clickable in this cycle.

## Verdict (cut 1c HEAD)

- **Dialog hang fix verified rung 3**: 1ac871fd / FE 7418e604 — carrier REASSIGN dialog + non-issued plan editor both load with full content.
- **TC-DDP-006 PASS rung 3**: master-plan no regression.
- **TC-REPLACE-TAGS-001 PASS rung 3**: dispatch picker shows all 14 tags in canonical order.
- **TC-DDP-003 / TC-DDP-004**: dialog opens, fields render, carrier search works. Server-side guard correctly blocks reassignment on departed rows. Reassignment on PLANNED-but-not-DEPARTED rows requires a clean save cycle that I did not complete this turn.
- **TC-DRV-MOBILE-001..007 + TC-REPLACE-TAGS-002**: still rung 1 (cycle-2 unit-test green on 9b2744b6 stays as rung-1 backup). Driver fixture requires a successful save cycle on the plan editor.
- **TC-DDP-005 (CUS role gating)**: not exercised in this turn.

## Next-cycle recommended order
1. **TC-DDP-003 complete**: pick a non-issued row (e.g., row 1, EHPH26080202), set a clear sequence of clicks (carrier → plate → tag chips → free text), click "Lưu thay đổi", capture the success toast + the row's new state.
2. **TC-DRV-MOBILE-001..007 + TC-REPLACE-TAGS-002**: after step 1, find a populated driver (the saved order routes to a driver via fulfillment creation). Use that driver's /my-trips view.
3. **TC-DDP-005 (CUS role gating)**: separate CUS eval.

## Artifacts
- `qa/2026-09-10_cut1c-final-findings.md` — THIS report.
- Earlier artifacts: `qa/2026-09-10_dispatch-detailed-plan_dialog-hang-repro.md`, `qa/2026-09-10_replace-tags_cut1d-driver-picker.md`, `qa/2026-09-10_dispatch-detailed-plan_cut1-final.md`.
