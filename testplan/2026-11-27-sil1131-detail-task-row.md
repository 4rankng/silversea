# SIL-1131 — màn chi tiết lệnh không hiện nhiệm vụ điều vận

Case ID: SIL-1131-R1..R2 (QA report 27/11 — `/my-trips/36`, Bill HANGH7529700).

**Ticket:** SIL-1131. Thẻ lệnh tab Đã nhận hiện "TÁC VỤ ĐẢO VỎ", e-POD hiện
"Ghi chú giao hàng: ĐẢO VỎ", nhưng màn chi tiết lệnh `/my-trips/36` không
hiện nhiệm vụ ở đâu cả; mục Ghi chú ghi "Không có ghi chú."
**Owner (implement):** frontend `pages/DriverTripDetailPage.tsx`.
**Owner (verify):** qa
**Status (this doc):** READY — regression recorded prior to implementation per AGENTS.md §6
**KB:** Ch.4 §4.2.2 (thứ tự nhóm "… → nhiệm vụ & ghi chú → bằng chứng &
hành động"; nhiệm vụ viết hoa dòng riêng), Ch.4 §4.2.5 (không có khối Tác vụ;
việc điều vận giao cho chuyến thể hiện qua nhiệm vụ & ghi chú), Ch.10 §10.4.2.

---

## Root cause (verified in source)

SIL-767 (09/11) bỏ toàn bộ chips khỏi màn chi tiết — `operationNote` chỉ còn
dùng `manualText`; tag "ĐẢO VỎ" (nhiệm vụ điều vận, format v2 driverTaskNote)
không render chỗ nào. Note rỗng → "Không có ghi chú." trong khi nhiệm vụ mất.

## Case SIL-1131-R1 — chuyến có nhiệm vụ → hiện đúng trong nhóm nhiệm vụ & ghi chú

- **Given** chuyến có dispatch note tag-composed (vd `ĐẢO VỎ`, knownTagLabels
  khớp) như chuyến 36.
- **When** mở /my-trips/:id.
- **Then** nhóm "Nhiệm vụ & ghi chú" hiện nhiệm vụ (chips viết hoa, dòng riêng,
  cùng nguồn parse với thẻ lệnh và e-POD); ghi chú manual-text hiện ở dòng
  Ghi chú; không có khối Tác vụ riêng.

## Case SIL-1131-R2 — không có nhiệm vụ → "Không có nhiệm vụ" trung thực

- **Given** chuyến không có tag nhiệm vụ nào.
- **When** mở /my-trips/:id.
- **Then** nhóm hiện "Không có nhiệm vụ" và "Không có ghi chú." (khi thiếu) —
  không im lặng, không bịa nhiệm vụ.
