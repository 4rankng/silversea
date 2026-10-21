# qa/2026-10-21-r29f-fb093-stgverify — FB-093 re-verify trên STAGING-BUILT FE

Task R29F: xác nhận fix `essentialWhenHasData` (FB-093 — cột "Thông số container"
chôn nút "Tách nhóm" phía Kế toán) trên **staging-built FE**, không phải local FE
(lần verify trước mới chỉ drive local :7191 → staging API). Card GDrive
`211026092400-fb093-verifyfail-tach-nhom-khong-hien.docx`. Đây là re-verify
**confirmatory** (card đã QA_TESTED ở lane trước) — không sửa code, chỉ evidence.

## Verdict: **PASS 5/5 (UI DRIVEN)**

| # | Bước | Verdict | Rung | Evidence |
|---|---|---|---|---|
| 0 | Build + fix live trên deployed chunk | PASS | chunk bytes | `00-build-and-fix-proof.txt` |
| A | Setup: UI tạo 2 lô LCL R29F + UI ghép cước thu khách | PASS 2/2 | UI DRIVEN | `setup-01..06*.png`, `setup-ui-driver.log`, `setup-net.log` |
| B | Surface chính: ketoan profile sạch → cột "Thông số container" tự hiện + nút "Tách nhóm" (cả 2 bill, enabled) | PASS | UI DRIVEN | `01-fresh-ketoan-board.png`, `dom-01-fresh-ketoan.txt`, `net.log` |
| D1 | Regression: stored choice `[]` vẫn render đủ cột + nút | PASS | UI DRIVEN | `02-regression-stored-empty-choice.png`, `dom-02-*.txt` |
| D2 | Regression: choice cũ `['phanXe']` — phanXe ẩn đúng choice, container VẪN tự hiện (2 luật không va chạm) | PASS | UI DRIVEN | `03-regression-stored-old-choice.png`, `dom-03-*.txt` |
| D3 | Regression: choice tường minh `['container']` vẫn THẮNG (không bị hồi sinh) | PASS | UI DRIVEN | `04-regression-choice-hides-container.png`, `dom-04-*.txt` |
| C | Flow: click "Tách nhóm" → dialog → xác nhận → unmerge 200 → board + DB đúng | PASS | UI DRIVEN | `05-tach-confirm-dialog.png`, `06-after-tach-board.png`, `db-1-after-tach.json`, `net.log` |

Script driver: `testplan/qa/scripts/2026-10-21-r29f-fb093-setup-merge.mjs` (setup+ghép)
và `testplan/qa/scripts/2026-10-21-r29f-fb093-tach-verify.mjs` (surface+flow+regression).
Log đầy đủ: `setup-ui-driver.log`, `ui-driver.log` (JSON results + steps), `*-net.log`.

## Build drift — đọc trước khi tin verdict

Task pin **ebd032fb**; resume pin **85ea2cef** (QA-script-only). Staging tiếp tục
recut trong lúc drive → build thực tế tại thời điểm verify: **806acf89** (merge
`feat-req07-trip-code-format` — chỉ đổi driver-display surfaces, KHÔNG đụng
accounting/debit). Drift KHÔNG bị chấp nhận im lặng:

- `00-build-and-fix-proof.txt` ghi lại health + timeline build.
- Proof trực tiếp: deployed chunk `AccountingDebitClosePage-DJu42oE9.js` (build
  806acf89) **chứa `essentialWhenHasData`** + label "Thông số container" +
  storage key `accounting-debit-hidden-cols` — fix FB-093 live trên đúng bytes
  mà browser tải. Surface được verify against build này.
- Muốn verify đúng pin: set `QA_EXPECT_BUILD=<hash>` khi chạy scripts (script
  abort khi health lệch pin).

## Chi tiết

### A — Setup data (staging QA-purge: tự tạo scenario, tag R29F)

- 2 lô hàng lẻ tạo qua UI `tiepvv /shipments/new` (mode "Hàng lẻ", KH YUANFANG,
  Xuất khẩu, Số Booking **R29F-01/R29F-02**, giao 20/10/2026 — trong window
  mặc định board kế toán 01→21/10):
  - **972** SHP-2610-00572 (R29F-01, 1500kg/3.5CBM) — POST `/api/shipments/quick` **201**
  - **973** SHP-2610-00573 (R29F-02, 2000kg/4.8CBM) — **201**
  - DB: `cargoMode=LCL`, `expectedDeliveryDate=2026-10-20`, `status=READY_FOR_DISPATCH`,
    `lockStatus=OPEN` (đối chiếu API — `setup-db-before-merge.json`).
- UI `tiepvv /shipments-debit`: chọn 2 lô → "Ghép cước thu khách" → dialog loại
  xe **"Xe 5 tấn"** → xác nhận → **merge 200**: cả 2 cùng revGroup
  (`134a72e9…`), revOrder 1/2, lô 2 = **0₫ + note "Ghép cước cùng Bill R29F-01"**
  (`setup-db-after-merge.json`). Đúng flow fb093 cũ (CL4C-01/CL4C-02).

### B — Surface chính (đây là lỗ hổng cần đóng)

`ketoan` profile **SẠCH** (browser mới, `localStorage.removeItem('accounting-debit-hidden-cols')`
trước khi app chạy — `storedChoice=null` xác nhận trong DOM dump) →
`/accounting/chot-debit`:

- Cột **"Thông số container" hiển thị** (KT4 `defaultVisible:'essential'` không
  còn chôn nó — `essentialWhenHasData` fire vì board có dữ liệu lcl).
- **Nút "Tách nhóm" trên từng dòng nhóm**: `aria-label="Tách nhóm ghép cước thu
  khách — lô R29F-01"` và `— lô R29F-02`, cả 2 `enabled`. (Board còn 9 nút của
  các nhóm ghép khác sẵn có trên staging — đúng luật, filter theo bill R29F.)
- KT4 giữ nguyên: cột tiền breakdown "Cước thu (tự động)" vẫn ẩn trên profile
  sạch.
- DOM fragment (header + cell chứa nút): `dom-01-fresh-ketoan.txt`.

### C — Flow "Tách nhóm"

Click nút trên dòng **R29F-02** → confirm dialog
("Tách nhóm ghép cước thu khách? Tiền cước của mỗi lô trở về đúng trạng thái
trước ghép, ghi chú \"Ghép cước cùng Bill\" được gỡ.") → "Tách nhóm" →
**`POST /api/shipments/lcl/unmerge-group` 200** `{"dimension":"REV","dissolved":true}`.

Sau tách (board + DB):
- Board: **0 nút/note R29F** còn lại (9 nút kia thuộc nhóm khác — đúng luật);
- DB (`db-1-after-tach.json`): cả 2 lô `revGroup=null`, `note=null`, `lock=OPEN`;
- Cước phân bổ lại đúng: lô chính 972 `freight=null` = đúng giá trị trước ghép
  (`setup-db-before-merge.json`); lô member 973 `freight="0"` — computed-zero
  **D02** (giá trị 0 có lý do "Tách khỏi nhóm ghép — chờ định giá lại" trong
  `freight_rate_snapshots`; residual kênh debit-summary không surface reason —
  đã ghi nhận từ R29, ngoài scope card này).

### D — Regression mini (2 luật không va chạm)

| Case | Stored choice | Kết quả |
|---|---|---|
| D1 | `[]` | Toàn bộ cột hiện (choice "không ẩn gì" thắng default) — container + nút R29F có mặt |
| D2 | `['phanXe']` | "Phân xe" ẩn ĐÚNG choice; "Thông số container" VẪN tự hiện + nút R29F còn → essentialWhenHasData không đạp lên choice, choice không dìm action column |
| D3 | `['container']` | Cột ẩn, không nút — choice tường minh THẮNG essentialWhenHasData (precedence: operator choice wins wholesale) |

## Note-literal trap (giải thích run 1)

Run 1 (`run1-note-literal-*`): SURFACE verdict fail 1/5 duy nhất vì assert tìm
chuỗi note **API** "Ghép cước cùng Bill R29F-01" trong khi **board DOM** render
"(Ghép cùng Bill R29F-01)" (label `ghépCùngRef` trong
`AccountingDebitClosePage.columns.tsx`). Raw DOM run 1 đã PASS mọi thực tế
(container header + 2 nút enabled) — đúng nhiễu "note-literal" mà verify R29
từng ghi nhận. Run 2 sửa assert theo literal của từng surface → 5/5. Không có
behavior change giữa 2 run.

## Verification coverage (§9)

| Claim / bug | Rung | Evidence | Not covered |
|---|---|---|---|
| Fix live trên deployed chunk (806acf89) | chunk bytes | `00-build-and-fix-proof.txt` | không A/B so sánh build không-fix trên cùng staging |
| A: UI tạo 2 lô LCL R29F (201 ×2) | UI DRIVEN | `setup-01/02-*.png`, `setup-ui-driver.log` `mutation_status`, `setup-net.log` | nhập tay qua form thật ngoài driver; mobile width; role khác tiepvv |
| A: UI ghép cước thu khách → revGroup + note + 0₫ | UI DRIVEN | `setup-03..06-*.png`, `setup-db-after-merge.json`, `setup-net.log` merge 200 | nhóm >2 lô; loại xe khác 5T; KH khác YUANFANG |
| B: cột "Thông số container" tự hiện + 2 nút Tách nhóm enabled (ketoan sạch) | UI DRIVEN | `01-fresh-ketoan-board.png`, `dom-01-fresh-ketoan.txt`, `ui-driver.log` board_01 | width 390/768; account kế toán khác (hoapt/liennt…); FCL-only board (không lcl) |
| B: KT4 giữ nguyên — "Cước thu (tự động)" vẫn ẩn | UI DRIVEN | `dom-01-fresh-ketoan.txt` (`moneyBreakdownVisible=false`) | các cột money breakdown khác ngoài header đã assert |
| C: click Tách nhóm → dialog → unmerge 200 → board cập nhật | UI DRIVEN | `05/06-*.png`, `dom-05/06-*.txt`, `net.log` unmerge 200 | error path (nhóm đã chốt kế toán bị disable); rollback; click nút dòng R29F-01 |
| C: cước/note trả về trạng thái trước ghép (972=null như trước, 973=0₫ D02) | DB/API VERIFIED | `db-1-after-tach.json` vs `setup-db-before-merge.json` | UI không hiển thị reason D02 (residual đã ghi nhận); đối chiếu sổ cái/billing document |
| D1–D3: 2 luật column-visibility không va chạm (3 precedence cases) | UI DRIVEN | `02/03/04-*.png`, `dom-02/03/04-*.txt` | choice payload khác; surface khác (CUS ledger); keyboard-only navigation |

## Data test để lại trên staging

Shipment **972/973** (SHP-2610-00572/573, Số Booking R29F-01/02) — dữ liệu test
có chủ đích, đã ghim tag "R29F" theo quy ước purge. Trạng thái cuối: cả 2
**ungrouped** (đã tách ở phase C), lock OPEN. Chu kỳ merge→unmerge ×2 (run 1 +
run 2) — audit `SHIPMENT_LCL_GROUP_UNMERGED` bởi ketoan, merge bởi tiepvv.

## Gates

| Gate | Kết quả | Log |
|---|---|---|
| `pnpm context:check` | exit 0 | `gates-context-check.txt` |
| `pnpm lint` (root) | 0 errors | `gates-lint.txt` |

(Không có src change — qa artifacts + scripts + HANDOFF chỉ; FE/BE gates không
affected theo AGENTS §5.)
