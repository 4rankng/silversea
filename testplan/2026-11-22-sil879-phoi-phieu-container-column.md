# SIL-879 — /accounting/phoi-phieu: số container tràn sang cột ĐỊA ĐIỂM ở 1440px (regression case)

Case ID: TC-SIL879-01
Feature: Bảng kiểm soát phơi phiếu (/accounting/phoi-phieu) — cột THÔNG SỐ CONTAINER trên board chốt ladder SIL-875.

## Hiện tượng (QA retest staging build 061739f9, 22/11/2026, Kế toán hoapt, 1440×900)
- Cột THÔNG SỐ CONTAINER chỉ rộng 80px (floor 78px + share 6.94%) trong khi số container 11 ký tự
  (BEAU4567896, CSNU1122338, KFPQ3112180, MNBU0000977…) đo scrollWidth 92–96px so với clientWidth 80px.
- Số container (nowrap, keep-all — không thể xuống dòng) tràn sang cột ĐỊA ĐIỂM NÂNG/HẠ: dòng R3B-BILL02
  hiện 'BEAU4567896Cảng Đình' — chữ số dính chữ địa điểm.

## Nguyên nhân
Floor cột thongso đo từ token ngắn 'TWCU2259939' (65px) — dữ liệu thật 11 ký tự rộng hơn (≈84px nội dung
+ 12px gutter). Token giữ nowrap theo luật số nên tràn cell thay vì wrap.

## Hành vi kỳ vọng
- Số container hiển thị TRỌN trong cột THÔNG SỐ CONTAINER, có khoảng cách với cột ĐỊA ĐIỂM NÂNG/HẠ.
- Không ellipsis, không cắt chữ (luật no-truncate / nowrap số SIL-873).
- Tổng bảng vẫn ≤ canvas 1440px (luật SIL-875 — bảng không cuộn ngang, không phantom scroll).

## Fix (2026-11-22)
Re-balance ladder, tổng floor giữ nguyên 1124px:
- `thongso` 78→100px (content capacity 88px ≥ 84px đo thực tế), share 6.94%→8.90%.
- Donor chỉ các cột wrap-only: `status` 84→78px (7.47%→6.94%), bốn cột Ghi chú 74→70px (6.5%→6.22%,
  làm tròn xuống giữ declaredSum < 100%).
- Ba nguồn sự thật khớp nhau: `PhoiPhieuControlPage.css` (vars + shares), `PCC_COL_WIDTHS` trong
  `PhoiPhieuControlPage.tsx` (--ppc-min/--ppc-share-scale), pins trong `PhoiPhieuControlPage.styles.test.ts`.

## Automated pins
- `frontend/src/pages/accounting/PhoiPhieuControlPage.styles.test.ts` — "every column carries its % share +
  px floor; the full thirteen-column set fits the 1440 canvas": floorSum = 1124, declaredSum < 100,
  thongso pin 8.90%/100px.

## Not covered bởi hồ sơ này
- Bằng chứng UI DRIVEN (rung 3) trên app thật 1440×900: dành cho QA retest trên staging sau deploy
  (orchestrator lo gates + deploy theo phân công ticket).
- Token container dài hơn 12 ký tự hoặc font glyph rộng hơn: floor 100px có 4px headroom trên đo lớn nhất
  (84px content); nếu dữ liệu tương lai rộng hơn cần đo lại ladder chứ không nới tay từng cột.
