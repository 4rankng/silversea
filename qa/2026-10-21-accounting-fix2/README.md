# FIX CHI PHÍ lần 2 (spec 19/10) — verify-first + fix — branch `fix-accounting-fix2`

Ngày 2026-10-21 · local dev stack CỦA WORKTREE NÀY: FE `:7185` → BE `:3012`
(cổng riêng để không đụng lane khác đang giữ 7175/3002) · DB dùng chung
`ss-prod-db:5441`. Staging KHÔNG đụng. Tài khoản: `ketoan` (ACCOUNTANT),
`giaonhan` (OPS), user OPS fresh mỗi run (`af2qa-*`, tạo qua admin, ví rỗng).

Nguồn spec: `19.10 - FIX CHI PHÍ.docx` — 11 ảnh mockup; tài liệu này session
KHÔNG có vision (model không hỗ trợ ảnh, Gemini CLI ineligible-tier, không có
GEMINI/vision key) — bố cục mockup lấy từ các mục `### Mockup:` đã có sẵn trong
`docs/prd/PhanHeKeToan.md` (OCR từ đợt trước, chủ sở hữu đã duyệt all-markdown
21/10). Ảnh gốc đã unzip tại `/tmp` media — không dùng được thêm.

## Kết luận từng mục (verify-first)

| # | Mục | Kết luận | Fix |
|---|---|---|---|
| 1 | Ops khai chi phí — ảnh tùy chọn | **ĐÃ ĐÚNG** — POST không ảnh (chứng cứ `RECEIPT`) 201; photo là 1/4 loại chứng cứ thay thế, không bắt buộc; form Ops cho photo set rỗng (`OpsExpenseFormModal` "empty photo set is normal, never a 'thiếu chứng từ' debt") | không cần |
| 2 | 1,000,000 + tabular-nums mọi ô tiền | **THIẾU → ĐÃ FIX** — 21 ô tiền chưa grouped (batch 1: 13 NumberField + 4 ShipmentFinance; batch 2: ~17 raw input string-state) + tabular-nums chưa khai ở shared primitives | sweep `grouped`/`signed` + `font-variant-numeric: tabular-nums` trên `.money`/`.num`/`.record-table .num`/`.ds-field--money input` + nới contract test. **Review R1**: 2 ô per-liter decimal GIỮ RAW (giá dầu gốc, ngưỡng VNĐ/lít — numeric(12,4)); refund field bỏ className wrapper (double chrome, F2 verified UI); treasury số dư đầu kỳ +`signed` (schema signed) |
| 3 | Phơi → Xem chi tiết → Thêm dòng: 2 tab | **ĐÃ ĐÚNG** — ExpenseCreateDrawer có đúng 2 tab cạnh nhau `["Tiền đường","Chi phí lô hàng"]` | không cần |
| 4 | BÁO CÁO THU/TRẢ PHƠI + phiếu thu/chi | **ĐÃ ĐÚNG + title bỏ sót khoảng ngày → ĐÃ FIX** — section + tab Phải thu/trả + party drill-down + phiếu hàng loạt có sẵn; heading thêm "— Ngày … – …" theo mockup | heading mang range |
| 5 | Chốt debit cột/highlight/Ngày | **ĐÃ ĐÚNG** — bật hết cột: 0 cell zero-width; click dòng: `data-selected` + td `rgb(232,248,238)` + `✓` trong ô Ngày; Chọn Debit: dialog "Chọn ngày (9/9 ngày · 116 lô)" tick từng ngày | không cần |
| 6 | Xuất debit không xuất được | **ĐÃ ĐÚNG TRÊN BUILD NÀY** — reproduce E2E: Khóa & Xuất → banner "Đã xuất Debit Note (1 lô, đã khóa chi phí 1 lô)", CDP `downloadWillBegin` "giay-bao-no-BULK-EXP-0176.xlsx", GET export 200/9922B PK (curl trực tiếp + qua vite proxy), DB `billing_documents#16191`. Bug gốc cũ (idempotency-key >100 ký tự + chặn lô chưa khóa) đã fix ở `selectionKeyOf` + "Khóa & Xuất" | không cần (đã land từ FB-094/§2e) |
| 7 | Duyệt tạm ứng → khớp số | **ĐÃ ĐÚNG** — PHÊ DUYỆT = giải ngân (funding ledger+treasury); fund-book `opsAdvance.totalOutstanding` == report `totals.remaining`: 127.000.000 trước phiếu, 126.850.000 sau duyệt phiếu (khớp tuyệt đối 2/2 lần) | không cần |
| 8 | Hoàn ứng ÂM cảnh báo | **ĐÃ ĐÚNG** — report row `needsCollection=true`, direction `CTY_YEU_CAU_THU_TIEN_UNG`; UI /accounting/hoan-ung hiện "ÂM — đề nghị thu lại tiền ứng"; phiếu PT-2610-0013 refund −50.000 tạo + duyệt OK | không cần |
| 9 | Ops chi phí → bảng tạm ứng KT hiện | **ĐÃ ĐÚNG** — phiếu hoàn ứng (mang đúng `tripExpenseId` Ops nhập) hiện ngay trong `/advance-settlements` kế toán; dòng nhân viên Ops có trong báo cáo hoàn ứng | không cần |

## §c spec question (đã chốt theo PRD, KHÔNG đợi ruling — theo chỉ thị controller)

1. **Duyệt tạm ứng = tick 'Ngày duyệt' (ảnh 8, dòng 107):** invariant SỐ là
   phần bắt buộc → PASS cả 2 thời điểm. Cơ chế UI hiện trường là NÚT
   "PHÊ DUYỆT TẠM ỨNG" + tab "Chờ duyệt" (owner-landed 181026183600, KHÔNG
   cột tick chọn-all) — đổi cơ chế là quyết định owner, ghi nhận không tự làm.
2. **Hoàn ứng âm (ảnh 9, dòng 109):** warning + đề nghị thu có mặt (xem mục 8).
   PRD ghi "(hiện cảnh báo, không hiện số âm trần trụi)" — hiện trường hiện số
   có dấu ĐỎ + nhãn theo owner ruling card 141026230770 (signed value là giá
   trị). Chênh wording spec-vs-ruling, giữ owner ruling.
3. **Ops chi phí hiện ở bảng tạm ứng KT (dòng 113):** PASS (mục 9).

## Font capability — tabular-nums (bằng chứng đo)

`fontTools` trên font bundle (`Be Vietnam Pro v1.002`, cả 3 weight) và bản
Google Fonts v12: digits PROPORTIONAL (Regular: 0=676, 1=385, 4=710 units),
không có feature `tnum` trong GSUB/GPOS. ⇒ Khai báo `tabular-nums` theo spec
là CSS đúng nhưng render còn proportional cho tới khi đổi typeface (quyết định
owner, chưa có chỉ thị). Hai trang debit đã đi trước với cùng ruling này.

## Artifacts

- `ui-ketoan-driver.log` + `ui-03-*.png`, `ui-04-*.png`, `ui-05-*.png`,
  `ui-06-*.png` — items 3/4/5/6 (UI DRIVEN).
- `ui-debit-export-driver.log` + `06-debit-*.png` + `debit-note-download/
  giay-bao-no-driverproof-16191.xlsx` (9922B, PK) — item 6.
- `advances-chain-driver.log` + `ui-07-advances-table.png`,
  `ui-08-hoanung-report.png`, `ui-09-kt-expense-workspace.png` — items 1/7/8/9.
- `money-after-driver.log` + `02-money-grouped-ops-advance.png` — item 2 sau fix.
- DB proof: `billing_documents` id 16191 (DEBIT_NOTE, CUSTOMER 22, kỳ
  2026-03-16, tạo 2026-10-21T12:31 bởi run UI); advance #8148→RECORDED +
  funding (ledger 77626 / treasury 14365); phiếu PT-2610-0013 (2216) refund
  −50.000, checked_by=3.

## Coverage table (§9)

| Claim / bug | Rung | Evidence | Not covered |
|---|---|---|---|
| 1 — Ops chi phí không ảnh được ghi nhận, không lỗi thiếu chứng từ | UI DRIVEN (API chain trong UI-run script; form code-read) | advances-chain-driver.log (HTTP 201 id 28611), OpsExpenseFormModal.tsx | không click nút Lưu trong modal Ops UI; mobile viewport |
| 2 — Mọi ô tiền grouped + tabular-nums | UI DRIVEN (1 field live-type) + CODE (sweep test 19+ surfaces) | 02-money-grouped-ops-advance.png, money-format-sweep CP2-M1..M6 | không type từng ô trên 19 màn; tabular digits vô hiệu cho tới khi font có tnum; trường đơn giá VND/lít (step 0.01) giữ nguyên vì grouped bỏ decimal |
| 3 — 2 tab "Tiền đường \| Chi phí lô hàng" | UI DRIVEN | ui-03-phoi-tienduong-dialog.png, ui-03-phoi-themdong-tabs.png (tabs=["Tiền đường","Chi phí lô hàng"]) | mobile 390px; tab Chi phí lô hàng không lưu phiếu mới |
| 4 — BÁO CÁO THU/TRẢ PHƠI + phiếu thu/chi + drawer | UI DRIVEN | ui-04-report-section.png, ui-04-party-lots-drawer.png ("Chưa xác định" → drawer + STK + Lập phiếu) | không đi hết flow lập phiếu (đã cover ở đợt 141026230760); other roles |
| 5 — debit cột/✓/Ngày tick | UI DRIVEN | ui-05-debit-all-columns-on.png, ui-05-debit-row-highlight.png (tdBg 232,248,238 + tick ✓), dialog "Chọn ngày (9/9)" | 390/768 viewport; >200 lô (cap path) |
| 6 — Xuất Debit Note | UI DRIVEN | 06-debit-export-result.png (banner), downloadWillBegin giay-bao-no-BULK-EXP-0176.xlsx, HTTP 200/9922B PK (curl 2 đường), DB billing_documents#16191, ui-debit-export-driver.log exit 0 | headed-browser save dialog thật; staging; >200 lô; headless blob-save không land file (driver-documented, bytes chứng minh qua HTTP) |
| 7 — Duyệt tạm ứng + khớp Sổ quỹ ↔ Còn phải hoàn ứng | DB/API VERIFIED (đủ chuỗi tạo→duyệt→so khớp) + UI bảng tạm ứng (screenshot, không click nút duyệt trong run này) | advances-chain-driver.log: 127.000.000==127.000.000 trước, 126.850.000==126.850.000 sau; ui-07-advances-table.png (nút PHÊ DUYỆT hiển thị) | không click PHÊ DUYỆT bằng chuột UI (đã cover qa/2026-10-21-hoanung-am UI DRIVEN); cột tick "Ngày duyệt" chọn-all không tồn tại (khác cơ chế, xem §c-1) |
| 8 — Hoàn ứng ÂM cảnh báo | UI DRIVEN (đọc UI) + API | ui-08-hoanung-report.png ("đề nghị thu lại tiền ứng"), report needsCollection=true, phiếu −50.000 duyệt OK | mobile viewport |
| 9 — Ops chi phí hiện phía kế toán | UI DRIVEN (API chuỗi) + UI screenshots | advances-chain-driver.log (settlement detail mang expense id; /advance-settlements thấy phiếu), ui-09-kt-expense-workspace.png | không mở từng row phiếu trên UI |

## Drivers (qa/scripts/)

- `2026-10-21-accounting-fix2-ui-ketoan.mjs [phoi|debit|all]`
- `2026-10-21-accounting-fix2-debit-export.mjs`
- `2026-10-21-accounting-fix2-advances.mjs`
- `2026-10-21-accounting-fix2-money-after.mjs`
- `2026-10-21-accounting-fix2-f2check.mjs` (review F2 verify)
- (lib `2026-10-21-accounting-fix2-lib.mjs` — hiện không dùng trực tiếp, giữ
  cho các lane sau)

## Independent review (R1 — code-reviewer, REQUEST_CHANGES → fixed)

1. F1 (major): giá dầu gốc đ/lít là decimal (`numeric(12,4)` domain, sibling
   decimal) → REVERT raw. Pin mới trong sweep test chống hồi quy.
2. F2 (major): refund field className wrapper double-chrome → DROP, verified
   UI (`02-f2-refund-field-1440.png`: outer no border, `ds-field--money`).
3. F3 (minor): treasury số dư đầu kỳ schema signed → thêm `signed` (giữ khả
   năng nhập âm vốn có).
4. F4 (minor): ngưỡng VNĐ/lít decimal → REVERT raw (state number|'' giữ
   nguyên payload null-or-number).
5. Nits 6-8: indent, placeholder ví dụ grouped, comment test — đã sửa.
   Finding 5 (billing mirrors rounding) — chấp nhận, ghi nhận (display-only).


Env mặc định cổng riêng của worktree (FE 7185/BE 3012) — chạy được ở bất kỳ
nào qua biến nếu cần.
