# case-SIL-712 — Dialog Chỉnh sửa điều phối: chỉ còn MỘT trường ngày giờ

- **Board:** SIL-712 (board id 712, identifier SIL-609) — "[BUG] Dialog Chỉnh sửa điều phối: thừa một trường ngày giờ — chỉ giữ một trường duy nhất"
- **Reported:** 2026-10-30, owner screenshot (container MATU2097066): dialog hiển thị CẢ "Giờ điều vận" lẫn "Giờ trả hàng" (cùng 08:00 29/10/2026).
- **Ruling:** owner 30/10 — dialog chỉnh sửa chỉ được có MỘT trường ngày giờ. "Giờ trả hàng" (trường SIL-80 bổ sung khi gán xe) là trường thừa; "Giờ điều vận" (lịch chạy mà cột thời gian của grid hiển thị) được giữ lại.

## Repro (trước fix)

1. Mở chi tiết điều phối (detailed plan) của container MATU2097066.
2. Bấm "Chỉnh sửa điều phối".
3. Quan sát: dialog có 2 trường ngày giờ — "Giờ điều vận" và "Giờ trả hàng".

## Expected (sau fix)

1. Dialog hiển thị đúng MỘT trường ngày giờ: "Giờ điều vận" (dòng LCL: disabled kèm lý do như luật SIL-473).
2. Không còn trường "Giờ trả hàng" nào trong dialog.
3. Lưu với "Giờ điều vận" đã sửa vẫn ghi appointment zone-aware ISO (+07:00 → UTC); body lưu KHÔNG BAO GIỜ chứa `plannedEndAt` — override "Giờ trả hàng" đang存储 (nếu có) phải sống sót nguyên vẹn qua mọi lần lưu từ dialog này (omit = untouched).
4. Draft nhập dở (incomplete segments) vẫn CHẶN lưu — không bao giờ clear âm thầm (luật QA-2026-09-26-23).
5. Enter trong segment "Giờ điều vận" đã nhập đủ vẫn lưu dialog (luật FB-002 giữ nguyên trên trường còn lại).

## Regression guards

- `frontend/src/features/dispatch/detailed-plan/DispatchPlanEditorCell.gio-dieu-van.test.tsx` — luật một-trường + các luật lưu (zone-aware, omit, incomplete-block, LCL disabled, dirty → khóa Phát lệnh).
- `frontend/src/features/dispatch/detailed-plan/DispatchPlanEditorCell.test.tsx` — luật Enter/FB-002 chuyển sang "Giờ điều vận"; stored override không bị đụng đến.
- `frontend/src/features/dispatch/detailed-plan/DispatchPlanEditorCell.sil590-dense.styles.test.ts` — grid templates không còn area `end`.
