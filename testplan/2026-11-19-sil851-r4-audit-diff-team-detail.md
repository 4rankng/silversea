# SIL-851 round 4 — audit old→new render + teammate team-scope detail (issue 987)

## Case A — audit-log old→new không render (defect A)

- **Repro (QA verbatim, build 8916df10):** hoapt → /audit-logs → search
  'R3P-677-R-QA3' → click row SHIPMENT_UPDATED → 'Chi tiết hoạt động' chỉ có
  actor/action/description/time, không có before/after. Payload tồn tại
  server-side (search trúng) nhưng UI không render.
- **Expected:** row SHIPMENT_UPDATED expanded và modal 'Chi tiết hoạt động'
  hiển thị field đổi kèm old → new (vd `blNumber: 'R3P-677-R' →
  'R3P-677-R-QA3'`). Tab 'Chuyến đi' phải phủ lot-domain rows (partition —
  round 4 QA thấy 0 ở cả 'Chuyến đi' lẫn 'Cấu hình').
- **Fix:** AuditLogPage render `payload.changes` ở cả row expansion lẫn modal
  (BE đã redact theo vai — finance rows không có changes → không render gì);
  audit-query classify lot-domain rows = 'trip' + FE audit-helpers mirror.
- **Regression pins:** `backend/src/tests/audit-log-accountant-lot-domain.test.ts`
  (category trip + partition hai chiều), `frontend/src/lib/audit-helpers.test.ts`,
  `frontend/src/pages/AuditLogPage.test.tsx` (row + modal + finance strip).

## Case B — teammate inline edit + drawer detail (defect B)

- **Repro (QA verbatim, build 8916df10):** nhóm CUS ACTIVE (tiepvv + thanhdc);
  thanhdc toggle ON, sửa Số Bill lot tiepvv MSCU7712000111 qua 'Sửa ô chứng từ'
  → toast 'Đã lưu ô dữ liệu lô hàng.' nhưng reload vẫn giá trị cũ;
  'Mở chi tiết lô hàng' → 'Không tìm thấy lô hàng CUS.'
- **Root cause (chứng minh local):**
  - Drawer/detail 404: route đã qua `assertCusLotVisible` (team-open) nhưng
    `loadShipmentRow` re-scope own-only (`buildScopeConditions(actor)` thiếu
    arm 2) → 404 ở tầng service. Fix: per-lot detail đọc team-open cả hai chế
    độ toggle (drill-down law), cùng executor seam.
  - Inline persist: API PUT/shipments/:id với payload FE giữ nguyên
    `{expectedVersion, blNumber, bookingRef: null}` trên HEAD **persist đúng +
    audit old→new** (đã chứng minh 2 lần, cả UI-DRIVEN). Không tìm thấy seam
    BE làm mất persist; các round trước QA quan sát qua surface drawer 404 +
    build staging cũ hơn. Giữ hành vi 404 loud cho lô ngoài nhóm.
- **Expected:** sửa ô chứng từ của teammate persist sau reload; drawer mở đủ
  nội dung lô teammate; cross-team (ngoài nhóm) vẫn 404.
- **Regression pins:** `backend/src/tests/unit/cus-visibility.test.ts`
  (loadShipmentRow team-open + own-only khi không có nhóm),
  `backend/src/tests/cus-team-toggle-list-expansion.test.ts` 5/5.
- **UI evidence:** `qa/2026-11-19_sil851_ui-drive/` — driver log + 2
  screenshots (audit modal, team drawer); 5/5 PASS trên local dev.
