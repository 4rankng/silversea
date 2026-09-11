# QA — ESCALATION DEFECT: SilverSea shows empty plate list on non-issued row

**Severity:** BLOCKING (per PM's plate-validation ruling). T3 fixture creation cannot complete until this is fixed.

**Repro path (deterministic):**
1. Open `https://vantai.tingting.vip/login`. Login as `dungnv` / `Abc123` (staging DISPATCHER per `testplan/testaccounts.txt`).
2. SPA redirects to `https://vantai.tingting.vip/dispatch`.
3. Navigate to `https://vantai.tingting.vip/dispatch-detail`. 11 rows in `.detailed-plan-grid__row`.
4. Click `.dispatch-assignment-cell__trigger` on row 1 (EHPH26080202 — UNASSIGNED, no quick-issue button).
5. Dialog "Chỉnh sửa điều phối · EHPH26080202" opens with: Nhà xe = HÀ AN, Xe / biển số = empty, Phân loại, Cước thu dự kiến, Cước trả dự kiến, Ghi chú tác vụ (14 tags), Ghi chú thêm, Hiển thị, Hủy / Lưu thay đổi.
6. Click the **Nhà xe** button (showing "HÀ AN"). Searchable-select listbox opens with 21 carrier options including "SilverSea — xe nội bộ", "BIỂN XANH", "ĐĂNG QUÂN", "DH-BẮC NINH", etc.
7. Click "SilverSea — xe nội bộ". The Nhà xe button now shows "SilverSea — xe nội bộ".
8. Click the **Xe / biển số** button (searchable-select id="dispatch-vehicle-13"). aria-expanded becomes "true". Listbox opens.
9. **Observed listbox content**: `<ul class="searchable-select__list" role="listbox"><li class="searchable-select__empty">Không tìm thấy xe phù hợp.</li></ul>` — **EMPTY**. Single `<li>` with text "Không tìm thấy xe phù hợp." (No suitable vehicles found).
10. **No search input is rendered** — the placeholder "Chọn hoặc nhập biển số" suggests "Select or enter plate", but the implementation does NOT expose a free-text entry. The listbox has no input field.

**Expected (per PM's escalation rule):**
- SilverSea demonstrably has trucks (issued rows show "15H-021.39" with carrier "SilverSea" — see row 0 on the same dispatch-detail page). When SilverSea is selected as Nhà xe, the Xe / biển số listbox should show at least the trucks already used by SilverSea on other rows.

**Actual:**
- Listbox shows only "Không tìm thấy xe phù hợp." (No suitable vehicles found). The dispatcher has no way to complete the dispatch edit for this shipment with SilverSea as the carrier.

**Hypothesis for fullstack debug (local first per Amendment 4):**
- The plate searchable-select query in the dialog may be filtering by additional criteria (e.g., the truck must have `carrierId = N` AND `status = AVAILABLE` AND `compatibleWithShipmentType = X`). If SilverSea's trucks don't match `compatibleWithShipmentType` for this shipment, the filter returns empty even though trucks exist.
- Alternative: the filter may require `driver_id IS NULL` (unassigned), and SilverSea's trucks might all be currently assigned to other drivers.
- Either way: this is a real defect on non-issued rows — the system blocks the save cycle entirely.

**Cross-reference:**
- TC-DDP-002 (unassigned containers visible) PASS
- TC-DDP-003 (assign carrier at detailed-plan level) BLOCKED by this defect
- TC-DDP-004 (reassign carrier) BLOCKED by the server-side "Không thể điều chỉnh tác vụ đã xuất phát" guard + this defect
- TC-REPLACE-TAGS-001 PASS
- TC-DRV-MOBILE-001..007 + TC-REPLACE-TAGS-002 DEFERRED (need T3 fixture = need this defect fixed)

**Escalation per PM's ruling:** "if SilverSea on a NON-ISSUED row ALSO yields an empty plate list, THAT is a defect — file it immediately with the carrier ID + screenshot-equivalent, and it goes to fullstack as a real bug."

**Artifacts:** this file (`qa/2026-09-10_plate-empty-defect-silversea.md`).
