# Test plan — Gộp hàng FE on-demand (cards 231026123901/902/903, spec 23/10)

Scope: FE-only trên nền grid redesign 23/10. BE đã live (71f1468b):
`cost_group`/`rev_group` tách biệt, per-lot CUS outputs, validation cùng KH.

## Case GH-FE-01 — Toggle [📦 Gộp hàng] ẩn/hiện cột CHỌN + floating bar (231026123901)

Steps (ĐV Tổng quát, ĐV Chi tiết, CUS Chi phí – Quyết toán; desktop 1440 + mobile 390):

1. Mở bảng: cột CHỌN/checkbox KHÔNG xuất hiện; nút [📦 Gộp hàng] (secondary)
   hiện trên thanh Filter.
2. Bấm [📦 Gộp hàng] → nút đổi "✕ Thoát gộp hàng" (active); cột CHỌN xuất hiện
   đầu bảng bên trái; ĐV: chỉ dòng LCL tick bật, dòng FCL dim/disable.
3. Tích 1 dòng LCL → floating bar đáy màn hình: "Đang chọn 1 lô: Tổng X | Y CBM
   — Lô 1 giữ 100%…" + nút hành động chính + Bỏ chọn.
4. Bấm [✕ Thoát gộp hàng] (hoặc hoàn tất gộp) → cột CHỌN tự ẩn, bar đóng,
   selection clear.

Expected: mặc định không checkbox ở cả 3 mặt; mode bật/tắt đúng luật; không phá
grid redesign (cards <640px, table ≥640px, sticky actions).
Ghi chú phạm vi: CUS tick bật cho MỌI dòng khi mode bật (xuất Debit Note cần chọn
lô FCL đã khóa — giữ contract cũ); gộp chỉ tính lô LCL chưa nhóm.

## Case GH-FE-02 — Popup Gán xe nhóm ĐV đúng 4 trường, hết BKS ảo (231026123902)

1. ĐV (Tổng quát hoặc Chi tiết): bật [📦 Gộp hàng], tích ≥2 lô LCL → bar →
   [Gán xe nhóm].
2. Popup: KHÔNG còn "BKS báo khách (ảo)" trường chung lẫn cụm per-lô; đúng 4
   trường: Loại xe tính cước trả ĐV* · Nhà xe* · BKS thực* · Cước trả ĐVVC
   (blank = auto tra bảng giá).
3. Xe tải → chỉ Nhà xe ngoài; cont 20/40 → cả Đội xe nội bộ + nhà xe ngoài.
4. Lưu → payload không chứa billingTruckNo/billingTruckNos; toast Lô 1 100%
   cước trả; chip "Lẻ · Ghép (i/N)" trên row/card; mode tự tắt.

## Case GH-FE-03 — CUS per-lot 3 outputs + Gộp xe thu khách 3 trường (231026123903)

1. CUS Chi phí – Quyết toán, mở chi tiết lô LCL chưa nhóm: 3 outputs per-lot —
   Loại xe thu khách · Giá cước thu khách (auto tra theo loại; nhập tay =
   override) · BKS báo khách (blank = BKS thực).
2. Bật [📦 Gộp hàng], tích 2 lô cùng KH → floating bar → [Gộp xe thu khách] →
   popup 3 trường: Loại xe thu nhóm* · BKS báo khách chung (blank = BKS thực) ·
   Cước thu Lô 1 (blank = auto).
3. Khác KH: FE chặn rõ "cùng một khách hàng" trước khi gọi API (BE 400).
4. Lưu → Lô 1 100% thu, lô kia 0₫ + tag "Ghép thu cước cùng Lô 1" dưới cước;
   nút [Tách nhóm] trên dòng đã gộp; mode tự tắt; tách nhóm → per-lot trở lại.

## Evidence

- Playwright before/after 390 + 1440: `qa/2026-10-23-gomhang-fe/`
- Vitest scoped: DetailedPlanGrid, AssignTruckGroupDialog, MergeRevGroupDialog,
  ShipmentDebitPage, DebitLotLclFacts, MasterPlanGrid, MasterPlanPage.
