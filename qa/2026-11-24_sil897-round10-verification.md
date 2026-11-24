# CR-010.1 round 11 (24/11) — 3 mục mới từ báo cáo test 24/11: evidence

Build dưới kiểm chứng: staging `vantai.tingting.vip` buildHash **224c2c3c**
(= origin/main HEAD, `/api/health` 2026-11-24T02:55Z) — đã mang mọi fix hôm
nay (7f6908f2 weight chain 07:25, e6e583b0 r9 sweep 07:28, 03ed3b61/7bf41a2c
widths 08:51, cfda1ac2 r10 reset 09:24, 224c2c3c 10:01).

## (1a) SIL-898 trọng tải '0.00' — VERIFIED FIXED, không sửa lại

R3Q-680-B (container '0.00', lô không khai, họ booking khai 5000): probe thực
chạy `resolveDeclaredCargoWeightKg` + `lockShipmentFreightRate(requirePrice)`
trên DB mirror trong transaction rollback (backend/probe-sil898.ts — đã xoá,
kết quả ghi tại đây):

- display chain → **5000**;
- freeze → **LOCK** (không 409 'Thiếu trọng tải'), outcome MANUAL pricing
  fallback cho thiếu điều khoản cước — hành vi đúng luật.

Luật "'0.00' = thiếu như null, validate theo giá trị hiển thị/fallback" chính
là 7f6908f2 (đã trên main + regression pins
`lot-pricing-grounds-weight-fallback.test.ts`). Quan sát 409 của tester khớp
build staging TRƯỚC 07:25.

## (1b) bảng tổng kết CONT / BILL — ĐÃ SỤA (commit này)

`bulkIssueRows` identity: có cả cont + bill → `CONT · BILL` (hai lô trùng số
cont 'RTAU4012043' phân biệt được); thiếu một trong hai giữ dạng 1 token.
Tests: `bulkIssueOrders.test.ts` (identity assertions cập nhật + case trùng
cont mới). Gates: vitest scoped 27/27, tsc -b 0 lỗi, eslint 0 lỗi.

## (1c) gate rơ-moóc/loại cont (R3M-KQ1) — ĐÃ SỬA (commit này)

`inferTrailerTypeFromContainerCode` + nhánh DOUBLE của
`requiredTrailerTypeForFulfillment`: nhận cả họ mã đầu-'2' — house labels
(20DC…) VÀ mã ISO size-type (22G1/22R1/25G1) — làm cont 20'; 4x/45/L5 giữ
40FT. Trước fix: mã '22xx' đọc thành yêu cầu 40FT → 409 oan "Rơ-moóc không
phù hợp" cho rơ-moóc 20FT trên chuyến 20'DC đơn. FE mirror `trailerFit.ts`
cùng luật, và 3 call-site picker đổi đọc CODE trước (`pricing.containerTypeCode`
— cùng cột `containerTypes.code` gate đọc), label chỉ đứng sau — advisory và
gate không thể lệch nhau vì code/label khác prefix. Tests: BE unit
`trailer-container-match.test.ts`, FE `trailerFit.test.ts` (case ISO mới),
DispatchPlanEditorCell.test.tsx 93/93.

## (2) SIL-904 — VERIFIED FIXED trên main, không sửa lại

- Độ rộng SỐ TỜ KHAI/SỐ HĐ/LOẠI PHÍ 124/126/120px + nowrap data cells đã trên
  main từ 03ed3b61 ("69/54/68px overflow-wrap:anywhere" trong báo cáo là build
  cũ); regression pins `OpsAccountantTab.styles.test.ts` 7/7.
- Chuỗi 'INV-4C-001INV-4C-001': audit độc lập hôm nay (riêng + ghi chú trong
  ops-accountant-tab.css từ 03ed3b61) qua MỌI đường ghi số HĐ (create lô/chuyến,
  batch, sửa nhanh SIL-882, modal sửa Ops, upsert source, mirror tripExpenses,
  legacy history) — tất SET nguyên giá trị, KHÔNG đường nào nối chuỗi. Giá trị
  nhân đôi trong DOM = giá trị nhân đôi ĐÃ LƯU trên dòng staging đó; sửa tại
  chỗ bằng chính nút sửa nhanh Số HĐ. Không thêm luật ẩn dữ liệu.

## (3) SIL-897 (b) + (d) — VERIFIED không tái hiện trên 224c2c3c

UI driver Playwright (chromium 1600×900, hoapt /accounting/ghep-bo-debit,
read-only; `qa/2026-11-24_sil897-round10_ui-driver.mjs` + log + png):

- (b) lưới ĐÃ LỌC ('9000') tại scrollLeft=600/500/700/900/975/1050/1100/1200:
  mọi label straddle dock edge đều được sweep r9 đặt `data-occluded` →
  `visibility: hidden` — 'Phí CSHT' (600) và 'PHÍ CHI HỘ (CÓ HÓA ĐƠN)'
  (975–1100) đều ẨN TOÀN, `leaks` rỗng mọi snapshot. Quan sát '→SHT' /
  '→PHÍ CH…' của QA khớp build TRƯỚC e6e583b0.
- (d) lưới CHƯA LỌC đang cuộn 600, gõ từ khóa: lọc là client-side
  (DebitMergePage filterDebitMergeRows) → keystroke đầu đổi array rows → r10
  reset scrollLeft 600→0 cùng commit → 'Cước phải thu' hiện đủ (left 1260.5 >
  edge 1036.5), không có trạng thái "về 0" sau settle. Điều kiện gốc r10
  (đổi bộ lọc khi đang cuộn) vẫn đúng như driver S3 của cfda1ac2. Cả hai điều
  kiện KHÔNG lỗi → không sửa.

Gates: DebitMergeGrid.test.tsx 28/28; FE `tsc -b` 0 lỗi; BE `tsc
-tsconfig.build.json --noEmit` 0 lỗi; eslint touched files 0 lỗi.
