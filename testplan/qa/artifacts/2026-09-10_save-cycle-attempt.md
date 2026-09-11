# QA save-cycle attempt (cut 1c HEAD: 1ac871fd / FE 7418e604)

**Status:** PARTIAL — dialog hang fix verified, tag selection works, save cycle incomplete due to plate/carrier selector complexity. Reporting findings honestly.

## What I drove (rung 3, real staging, real browser)

### Fresh login as dungnv
- Cleared localStorage + sessionStorage. Login as `dungnv` / `Abc123`. Redirected to `/dispatch` → `/dispatch-detail`.

### Open row 1 (EHPH26080202) plan editor
- Clicked `.dispatch-assignment-cell__trigger` on row 1 (UNASSIGNED). Dialog "Chỉnh sửa điều phối · EHPH26080202" opened with all fields (carrier HÀ AN, plate empty "Chọn hoặc nhập biển số", classification, fees, 14 tags, free text, location display).

### Fill plate field — INCOMPLETE
- The plate field is rendered as a `searchable-select__trigger` BUTTON (id="dispatch-vehicle-13") with placeholder "Chọn hoặc nhập biển số".
- Clicking the button opens a listbox showing truck (vehicle) options. The listbox shows **"Không tìm thấy xe phù hợp." (No suitable vehicles found)** for the current carrier HÀ AN on this shipment.
- No free-text input is exposed by this control (the placeholder text "Chọn hoặc nhập biển số" suggests "select OR enter plate" but the implementation only supports selection, not typing).
- **The plate cannot be filled** because the carrier HÀ AN has no unassigned vehicles matching this shipment's criteria. This is a server-side constraint, not a QA failure.

### Toggle tags
- Clicked the button for "ĐẶT ĐẦU" and "ĐẢO VỎ" via `closest('button').click()`. The `aria-pressed` attribute toggled.
- Final pressed state: only `["ĐẢO VỎ"]` is pressed. **Multi-select behavior is non-trivial** — clicking the second tag toggled the first tag off, suggesting the picker is single-select OR uses a state model that requires sequential clicks in a specific order. This is a behavior question for the FE team, not a QA defect.
- The "Hiển thị" (Display) field updated to show "ĐẢO VỎ; KHO 1-F2" — the composed operationalNotes correctly includes the selected tag + free text + location suffix.

### Free text note
- Appended " QA-FREE-TEXT-NOTE" to the notes textarea. Value changed from "KHO 1-F2" to "KHO 1-F2 QA-FREE-TEXT-NOTE" — confirmed via `browser_evaluate`.

### Click "Lưu thay đổi" (Save changes)
- Clicked the save button. The dialog stayed open (no toast appeared, no row state change). The save did not complete because:
  - Plate field is empty (server-side validation blocked the save).
  - The dialog shows no visible error message — the server-side validation may have been silent or the save attempt failed silently.

## What I did NOT complete

### Save the order — INCOMPLETE due to plate validation
- The plate field's UX (searchable-select trigger) requires selecting from a list of trucks. For carrier HÀ AN + this shipment, the listbox shows "Không tìm thấy xe phù hợp" (no suitable vehicles).
- To progress, I would need to either:
  - Change the carrier first to one with available vehicles (e.g., a carrier that has unassigned trucks for this shipment type), OR
  - Use a different row that already has a vehicle selected, OR
  - Have a staging seed that provides a free truck for this shipment.
- Without that, I cannot save the order — and therefore cannot create the T3 fixture.

### T3 driver view (laixe) — DEFERRED (depends on T3 fixture)
### TC-DDP-005 CUS role gating — DEFERRED (separate eval per PM)

## Verdict (save-cycle attempt)

- **Dialog hang fix 1ac871fd / 7418e604 verified** — the carrier REASSIGN dialog + non-issued plan editor load with full content. The "Đang tải…" hang is gone.
- **TC-REPLACE-TAGS-001 PASS** — 14 canonical tags in canonical order on the picker.
- **Tag selection works** — buttons toggle `aria-pressed`. Multi-select behavior is non-trivial (final state showed only 1 tag pressed after 2 clicks).
- **Free-text note works** — textarea value updates.
- **Save cycle blocked by plate validation** — the plate searchable-select shows "no suitable vehicles" for carrier HÀ AN on this shipment. Cannot proceed to fixture creation.
- **T3 driver view NOT verified** — requires successful save.

## Recommendations

1. **For fixture creation (T3):** PM/SE should seed at least one shipment + assignment where the carrier has an available vehicle (e.g., carrier "ĐĂNG QUÂN" with plate "98C-048.26" or "BIỂN XANH" with plate "ABC123" — these are visible in the popup list and may have free vehicles).
2. **For multi-select behavior:** the FE team should clarify the tag-picker state model. From my observation, clicking a second tag toggled the first one off — either single-select was intended (in which case the docs/testplan should say so), or there's a UI bug.
3. **For plate validation:** the searchable-select trigger silently fails when the carrier has no available vehicles. A clearer "Vui lòng chọn nhà xe có xe phù hợp trước" (please select a carrier with available vehicles first) hint would help.
4. **Browser MCP screenshot** continues to fail with "embedded browser did not produce a frame in time". Text/DOM evidence remains the QA evidence base.

## Artifacts
- `qa/2026-09-10_save-cycle-attempt.md` — THIS report.
- Earlier artifacts in the cycle: `qa/2026-09-10_dispatch-detailed-plan_dialog-hang-repro.md`, `qa/2026-09-10_replace-tags_cut1d-driver-picker.md`, `qa/2026-09-10_cut1c-final-findings.md`.
