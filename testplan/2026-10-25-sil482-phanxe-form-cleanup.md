# Test plan — SIL-482 form PHÂN XE (BKS báo khách Ảo) dọn theo consult 24/10

Ticket: SIL-482 (board id 542). Consult spec (deepseek — bảng px) ghim trong
comment ticket 24/10. Surface: khối PHÂN XE trên strip `DebitLotLclFacts`
(Chi phí - Quyết toán `/shipments-debit`, mở rộng lô LCL) + hình học nút ×
dùng chung của `ComboBox` (Untitled UI base).

Lỗi gốc (owner screenshot 24/10 + DOM measure trước vá, lô
SIL172A610657 / shipment 297 — BKS thực 29H-657.77, BKS báo khách 88Q-10657):

1. Placeholder tiếng Anh "Search" trên ô "Nhà xe - BKS thực" (default của
   `ComboBox` khi caller không truyền placeholder).
2. Giá trị đã lưu chồng lên nút ×: ghost-value span không có khoảng đệm phải
   cho nút × — đo được text∩× = 5×16px (textGap −5px) ở 1440/768/660.
3. Flex-wrap stagger: hai field trôi thành 2 hàng lệch nhau, "Lưu BKS" dính
   vào dòng helper text, label wrap bị cắt ("Ảo)" — screenshot owner).
4. Nút × hit area 18×18 tại right:4 — nhỏ hơn chuẩn chạm.

## TC-SIL482-01 — Placeholder Việt hóa
1. Mở `/shipments-debit`, mở rộng lô LCL (kebab → "Mở chi tiết lô").
2. Ô "Nhà xe - BKS thực" placeholder **"Chọn nhà xe / BKS thực…"**.
3. Không input nào trong strip còn placeholder "Search".
4. Ô "BKS báo khách (Ảo)" giữ nguyên luật placeholder FB-141: = BKS thực khi
   có, else "Trống = tự động dùng BKS thực".

## TC-SIL482-02 — Grid 2 cột, hết stagger/clip
1. Hai field BKS nằm cạnh nhau trong `.debit-lot-lcl-facts__truck-grid`
   (grid 2 cột `minmax(0,1fr)` gap 16; <640px stack 1 cột).
2. Không label nào wrap bị cắt; strip không overflow ngang
   (`stripHOverflow = 0`), nhãn đo `wraps:false, clippedByStrip:false`.

## TC-SIL482-03 — Nút × không chồng giá trị (shared fix)
1. Ô có giá trị: nút × 24×24 tại right:8, icon 16px; text và × cách nhau
   (textGap dương — đo 72–74px sau vá; trước vá −5px).
2. Input VÀ ghost span đều có pr-8 (32px) khi có nút × — contract class test
   `combobox.test.tsx` "clearable value carries the × clearance contract".

## TC-SIL482-04 — Hàng action "Lưu BKS"
1. Nút "Lưu BKS" nằm ngoài grid, trong hàng action riêng phải-dưới
   (`.debit-lot-lcl-facts__actions`, margin-top 16, justify-end).
2. Nút primary cỡ 40px (`min-h-10`, `bg-brand-solid`); vẫn disable khi chưa
   dirty và gửi đúng wire FB-141 (billingTruckNo null khi trống).

## Bằng chứng UI (§9)
- Driver: `qa/2026-10-25_sil482-phanxe_ui-driver.mjs` (puppeteer-core,
  token hoapt/ACCOUNTANT pre-injected, Vite worktree :7185 → backend :3002).
- Trước/sau: `qa/2026-10-25_sil482-phanxe_{before,after}-{strip,full}-{1440,768,660,390}.png`
  + DOM JSON `..._{before,after}-dom.json` + log driver `..._before/after-driver.log`.
- 390px: strip KHÔNG mount — ≤640px trang chuyển layout card điện thoại
  (`ShipmentDebitRecords` → `ShipmentDebitWorkspace`), khác surface, không
  thuộc ticket này; screenshot 390 ghi nhận surface đó.
