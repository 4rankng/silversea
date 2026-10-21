# Evidence Pack — 9 card QA R30 ghi "chưa implement" nhưng ĐÃ SHIP

Ngày: 2026-10-21 · Pin kiểm chứng: **branch `evidence-shipped-9cards` @ `536aad6c`** (trunk `main` cùng commit).
Môi trường verify: **LOCAL** — frontend `:7175`, backend `:3002`, Postgres `:5441` (ss-prod-db), chạy từ worktree pin `536aad6c`. Staging không bị đụng tới (immutable).

## Phát hiện mấu chốt về base của QA

**QA test trên `6110af65` — commit này ĐÃ CHỨA (ancestor) tất cả các commit ship của 9 card dưới đây** (kiểm bằng
`git merge-base --is-ancestor <c> 6110af65` = YES cho cả 7 commit: `ba9981c2`, `a5e0039b`, `032145a2`, `0f7e1dfa`,
`ea200241`, `f0986f4c`, và merge FB-020 `da73a743`/`3fd77532`). Tức là các verdict "chưa implement" bị chấm **ngay
trên code đã có tính năng** — QA đã re-check nhầm bề mặt (URL/thao tác sai chỗ), không phải thiếu code.

## Bảng verdict 9/9 — SHIPPED, UI DRIVEN

| # | Card (ID GDrive) | Yêu cầu | Verdict | Bề mặt QA re-check (URL + thao tác + cái nhìn thấy) | Commit ship | Screenshot + bằng chứng |
|---|---|---|---|---|---|---|
| 1 | cus-11 (211026125915) | Thứ tự chứng từ Bill/Booking → Số tờ khai → Nhập/Xuất → Hãng tàu | **SHIPPED — UI DRIVEN** | `/shipments/:id` (Ví dụ `/shipments/312306`, vai `cus`) — header card "Sẵn sàng điều xe": dòng theo đúng thứ tự **Số Bill / Số Booking → Số tờ khai → Xuất / Nhập → Hãng tàu**. Thêm tờ khai `TKQA9cards01` qua "+ Thêm tờ khai" → header cập nhật ngay | `ba9981c2` | `ui-cus11-header-before/after.png`, `ui-cus11-decl-dialog.png`, DB row `3340` (`db-cus11-decl-row.txt`), `ui-driver-cus.log` |
| 2 | dis-09 (211026130015) | Phát lệnh xe ngoài CHƯA có biển số | **SHIPPED — UI DRIVEN** | `/dispatch-detail` (vai `dieuvan`) — ô "Điều phối" → **Sửa** → Nhà xe ngoài + xe **"Bổ sung sau"** → Lưu → chip **"Chờ bổ sung biển"** + nút **Phát lệnh** → click → hộp thoại **"Phát lệnh chưa có biển số xe nhà xe ngoài — … Vẫn phát lệnh?"** [Hủy/Xác nhận] → Xác nhận → dòng **"Đã phát lệnh cho tài xế"**, BKS trống | `a5e0039b` | `ui-dis09-editor-deferred.png`, `ui-dis09-awaiting-plate-row.png`, `ui-dis09-confirm-dialog.png` (sạch), `ui-dis09-issued-row.png`, DB: trip `194088 / TRP-202610-1586` tạo `07:19:32` với `truck_id NULL` + fulfillment `EXTERNAL/plate NULL` (`db-dis09-trip.txt`, `db-dis09-fulfillment.txt`), instance #2 trip `194086` (BULK-IMP-0235) trong `ui-driver-dispatch.log` |
| 3 | lcl-02 (211026130115) | Đơn giản form Thêm kho | **SHIPPED — UI DRIVEN** | `/shipments/new` (vai `cus`) — chọn khách → mode **Hàng lẻ** → section tuyến → nút **"Thêm kho"** → dialog quick-add tiêu đề **theo hướng hàng**: "Thêm kho **lấy hàng**" (Nhập) / "Thêm kho **trả hàng**" (Xuất), body gọn 3 trường **Tên đầy đủ / Tên ngắn / Địa chỉ** (không mở form master-data) | `032145a2` | `ui-lcl02-quickadd.png`, `dom-lcl02-quickadd.json`, `ui-driver-cus.log` |
| 4 | lcl-03 (211026130215) | Bỏ trường rườm rà LCL ("Lịch & ghi chú") | **SHIPPED — UI DRIVEN** | `/shipments/new` — toggle **Hàng lẻ**: form **KHÔNG còn** section "Lịch & ghi chú" (không có "Ghi chú cho khách hàng"/"Ghi chú cho lái xe"); FCL vẫn giữ nguyên | `0f7e1dfa` | `ui-lcl0305-form.png` + `ui-lcl0305-form-full.png`, `ui-driver-cus.log` |
| 5 | lcl-04 (211026130315) | Gợi ý quy cách đóng gói | **SHIPPED — UI DRIVEN** | `/shipments/new` (LCL) — combobox **"Quy cách đóng gói"** placeholder "Chọn hoặc nhập quy cách (Pallet, Roll, Carton…)"; mở ra danh sách gợi ý **Thùng gỗ, Pallet, Roll, Carton, Box, Crate, Khung, Bao, Can** | `0f7e1dfa` | `ui-lcl04-packaging-suggestions.png`, `ui-driver-cus.log` |
| 6 | lcl-05 (211026130415) | Nhãn "Ngày giao hàng" | **SHIPPED — UI DRIVEN** | `/shipments/new` (LCL) — trường ngày hiển thị nhãn **"Ngày giao hàng"** (thay nhãn cũ), luôn hiện | `0f7e1dfa` | `ui-lcl0305-form.png` (label thấy ngay trong ảnh), `ui-driver-cus.log` |
| 7 | lcl-07 (211026130515) | Tính cước gom/tách (REQ-19) | **SHIPPED — UI DRIVEN** | `/dispatch-detail` (vai `dieuvan`) — Bộ lọc → **Loại hàng: Hàng lẻ (LCL)** → tích 2 lô (03519+03520) → **"Gán xe nhóm"** → dialog: dòng advisory **"Tổng 2 lô: 2.350 kg · 4 CBM — <loại xe>: vừa tải/quá tải…"**; Lưu → toast **"Đã gán nhóm xe cho 2 lô — Lô 1 (…) giữ 100% cước trả ĐV, các lô còn lại 0₫"**; nút **"Tách nhóm"** trên Lô 1 giải tán (đã test cả chu kỳ gom→tách, idempotent) | `ea200241` | `ui-lcl07-fit-advisory.png`, `ui-lcl07-assigned-toast.png`, `dom-lcl07-fitline.txt`, `dom-lcl07-toast.txt`, DB: `cost_group f3ce808c…` order 1/2, `actual=billing=51QA-009.99` (`db-lcl07-group.txt`), `ui-driver-dispatch.log` |
| 8 | dri-01 (211026130743) | SĐT kho — tel: chạm-gọi | **SHIPPED — UI DRIVEN** | `/my-trips/85065` (vai `quyet`, mobile 390px) — grid THÔNG TIN LỆNH: **"SĐT kho"** = `<a href="tel:02253555555">`, **"SĐT liên hệ"** = `tel:0987654321`; nút **"Gọi kho"** mở sheet "Chọn liên hệ…" với các số là tel: link (số có dấu chấm `0901.234.567` → `tel:0901234567`) | `f0986f4c` | `ui-dri01-info-grid-tel.png`, `ui-dri01-call-sheet.png`, `db-dri01-grid.json`, `db-dri01-call-sheet.json`, `ui-driver-driver.log` |
| 9 | dri-04 (211026130843) | Cảng hạ / địa chỉ map (IMPORT không cảng) | **SHIPPED — UI DRIVEN** | `/my-trips/194040` (vai `quyet`, mobile 390px) — hàng IMPORT không có cảng hạ: dòng **"Cảng hạ" = "NM REGPK ow8t61419"** (KHÔNG còn "Chưa có cảng hạ"), kèm dòng **"Địa chỉ giao hàng" = "NM REGPK ow8t61419, Khu 2, Phường Võ Cường, Tỉnh Bắc Ninh"** | FB-020 (`da73a743` ⊃ `3fd77532`) | `ui-dri04-cangha.png`, `db-dri04-cangha.json`, `ui-driver-driver.log` |

Chú thích lcl-07: advisory render đủ tổng khối lượng/CBM theo lớp xe; lớp xe test đầu danh mục có mã không tra được
tải trọng nên dòng hiển thị nhánh giải thích "không đọc được tải trọng từ mã loại xe…" — vẫn là đúng bề mặt REQ-19
(3 nhánh vừa tải / quá tải / không đọc được được phủ bởi unit test `shared/src/constants/lcl-cargo-fit.test.ts`).

## Cách tái chạy (local, pin `536aad6c`)

```sh
make dev  # FE :7175 / BE :3002 / PG :5441
node testplan/qa/scripts/2026-10-21-evidence-9cards-cus.mjs       # cus-11, lcl-02/03/04/05
node testplan/qa/scripts/2026-10-21-evidence-9cards-dispatch.mjs  # lcl-07, dis-09 (idempotent: tự Tách nhóm/đổi lô)
node testplan/qa/scripts/2026-10-21-evidence-9cards-dis09-clean.mjs # dis-09 lần sạch (lô BULK-IMP-0127)
node testplan/qa/scripts/2026-10-21-evidence-9cards-driver.mjs    # dri-01, dri-04 (mobile 390)
```

Driver: puppeteer-core + Chrome thực, token inject trước SPA navigation; ảnh chụp sau click, DOM assert từng bước,
log `ui-driver-*.log` kèm exit status (Script A 16 PASS / Script B 0 fail / Script C 0 fail trong lần chạy cuối).

## Mutation DB trên local QA (đã lưu bằng chứng trong thư mục này)

- cus-11: `shipment_declarations` row `3340` (TKQA9cards01, shipment 312306) — tạo qua UI.
- lcl-07: nhóm cước `f3ce808c…` trên 2 lô 03519/03520 (gom→tách→gom lại qua UI, idempotent).
- dis-09: trip `194088` (BULK-IMP-0127) + `194086` (BULK-IMP-0235) — phát lệnh xe ngoài chờ biển số (plate NULL).

## Gates

`gates-tsgo-lint.txt` — `pnpm lint` 0 lỗi, `frontend tsc -b` 0 lỗi, `backend tsc --noEmit` 0 lỗi.
**0 thay đổi src** — không có fix nào cần thiết; 9/9 bề mặt khớp spec như audit. Không chạy thêm vitest (không có fix).

## Phủ phủ (Not covered) — §9

| Claim | Rung | Evidence | Not covered |
|---|---|---|---|
| cus-11 thứ tự + thêm tờ khai | UI DRIVEN | `ui-cus11-*.png`, DB row 3340, log | Role khác (non-CUS đọc header), width 390/768 cho header này |
| dis-09 phát lệnh chờ biển | UI DRIVEN | `ui-dis09-*.png`, trip 194088/194086 DB, log | Luồng "Phân xe lại bổ sung BKS sau issue"; chốt "Hoàn thành" bị chặn khi chưa có biển (chỉ assert qua text confirm) |
| lcl-02 quick-add kho | UI DRIVEN | `ui-lcl02-quickadd.png`, DOM json | Nhánh Xuất khẩu ("Thêm kho trả hàng") — assert code-level, chưa chụp ảnh |
| lcl-03/05 form LCL | UI DRIVEN | `ui-lcl0305-form*.png` | Flow submit end-to-end tạo lô LCL |
| lcl-04 gợi ý quy cách | UI DRIVEN | `ui-lcl04-packaging-suggestions.png` | Nhập giá trị tuỳ ý ngoài gợi ý |
| lcl-07 gom/tách cước | UI DRIVEN | `ui-lcl07-*.png`, DB group, log | Nhánh "vừa tải/quá tải" trên lớp xe có tải trọng (chụp ở nhánh không-đọc-được); 3+ lô |
| dri-01 tel: gọi kho | UI DRIVEN | `ui-dri01-*.png`, JSON grid/sheet | Hành vi dialler hệ điều hành (ngoài scope browser) |
| dri-04 cảng hạ portless | UI DRIVEN | `ui-dri04-cangha.png`, JSON | Hàng EXPORT + LCL direction-owned (phủ bằng unit `delivery-stage.test.ts` / `liftDropPoints`) |

Mọi rung-3 trên được chạy trên **local pin `536aad6c`** — đúng các commit ship; không claim gì trên staging.
