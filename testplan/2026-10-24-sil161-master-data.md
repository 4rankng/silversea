# SIL-161 — Master-data: Fleet + Đối tác + Rate Engine (regression note)

Case IDs: TC-SIL161-01 (tab Đội xe nội bộ), TC-SIL161-02 (tab Đối tác),
TC-SIL161-03 (ma trận phí nâng/hạ), TC-SIL161-04 (ma trận giá cước),
TC-SIL161-05 (fixture↔chuyến consistency), TC-SIL161-06 (UI driven 1440).

Spec: 2026.10.24_Demo_layout.docx §PHÂN HỆ 4 (/master-data). Ticket SIL-161
(board plan.tingting.vip/tingtingsoft/SIL). Branch `demo24-master`, off main
after the SIL-155 demo-shell merge (c159b614).

## Scope under test

- `/demo/master-data` — 3 tabs trên house `Tabs` primitive (boxed):
  1. **Đội xe nội bộ** — bảng đầu kéo (BKS + model · tài xế mặc định · SĐT ·
     CCCD · hạng GPL · rơ-moóc), chips ghép cặp mặc định
     [Đầu kéo + Rơ-moóc + Tài xế] gắn theo xe, search không dấu, thêm đầu
     kéo (chặn trùng BKS) — state fixtures của phiên.
  2. **Đối tác** — 3 bảng searchable: Khách hàng/chủ hàng (8), Nhà máy/KCN
     (8, suy ra từ khách hàng), Nhà xe phụ (3, kèm số chuyến fixtures).
  3. **Rate Engine** — (a) ma trận phí Nâng/Hạ: hàng = cảng/bãi (4), cột =
     20′/40′ × Xuất/Nhập × Nâng/Hạ (8 cột, 3 cấp header); (b) ma trận giá
     cước: KH × tuyến × cỡ cont (14 dòng). Ô tiền editable (click → input →
     Enter/blur commit, Esc hoàn), hover/focus tô sáng chéo hàng+cột.
- Fixtures mới `frontend/src/demo/data/master-data.ts` — nhất quán với seed
  chuyến SIL-155 (mỗi phí nâng/hạ của chuyến trỏ đúng ô ma trận; chuyến nhà
  có routeText trùng tuyến thì cước = giá chuẩn theo cỡ cont).

## Reproduction / expected behavior

- TC-SIL161-01 — mở /demo/master-data: mặc định tab Đội xe nội bộ; tìm
  "469" còn đúng 1 dòng (72L-846.30), "tam" ra TRK-01 (không dấu), "zzz" →
  empty state; Thêm đầu kéo 51C-999.99/51R-999.99/DRV-01 → dòng mới + chips;
  BKS trùng → lỗi inline "đã tồn tại", không thêm dòng.
- TC-SIL161-02 — tab Đối tác: 3 bảng đủ counts (8/8, 8/8, 3/3); search
  "samsung" ẩn Intel, "VSIP" ra KCN VSIP II, "HTD" ẩn Nam Hải.
- TC-SIL161-03 — ma trận phí: header 3 cấp thẳng cột (Cảng/Bãi rowSpan=3);
  Cát Lái 20′ Xuất Nâng = 1.250.000 ₫; hover ô CL-40-Xuất-Hạ tô sáng cả
  hàng CL + cột Hạ 40′ Xuất; sửa VICT 20′ Xuất Nâng → 1.350.000 → ô hiển thị
  "1.350.000 ₫" + dòng "Đã lưu —…"; sửa rỗng → hoàn giá cũ.
- TC-SIL161-04 — ma trận giá cước: 14 dòng đủ 8 KH; sửa FR-01 40′ →
  5.000.000 → commit + "Đã lưu — Samsung…".
- TC-SIL161-05 — fixture integrity: 8 cột × 4 cảng, VND nguyên dương; mọi
  phí lift/drop của 20 chuyến = ô ma trận tương ứng; ≥10 chuyến nhà trùng
  tuyến + cước chuẩn; factory directory chia 8 KH đúng 1 lần mỗi mã.
- TC-SIL161-06 — real browser 1440×900 (Puppeteer, login admin thật,
  token inject trước SPA): 16/16 DOM assertions, 0 console error;
  artifacts `qa/2026-10-24-demo24/` (8 screenshots + driver log + script).

## Automated coverage

- `frontend/src/demo/data/master-data.test.ts` (TC-05)
- `frontend/src/demo/pages/demo-master-data.test.tsx` (TC-01…04, jsdom)
- Run: `cd frontend && npx vitest run src/demo` — 39/39 pass (gồm test
  SIL-155 có sẵn); `npx tsgo --noEmit` + `npx tsc -b` = 0 lỗi.

## Not covered (giới hạn)

- Mobile 390/768: bảng ma trận 8 cột cuộn ngang trong card (`overflow-x`)
  — chưa sweep role-ui-sweep (demo tree nằm ngoài sidebar production; sweep
  route /demo/* là việc của cả demo initiative, không riêng lane này).
- Persistence: mọi chỉnh sửa chỉ nằm trong React state của phiên (spec demo
  fixture-only, không gọi API) — không có DB side effect để kiểm chứng.
- Các lane demo khác (dispatch/port/billing/driver-app) đang chạy song song
  trên branch riêng — merge order do orchestrator quyết.
