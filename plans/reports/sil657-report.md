# SIL-657 (issue 764) — Form tạo lô hàng lẻ: mất trường Số tờ khai + tờ khai không cập nhật vào lô

Lane: `fix/sil657-lcl-declaration-field` · Worktree: `/Users/dev/.paseo/worktrees/1njkloyy/fix-sil657-lcl-declaration-field` · Base: `main` (8440cf2d)
Ngày: 2026-11-02 · Backend probe: `:3005` (worktree này) · Frontend: `:7189` · DB: `ss-prod-db:5441/silversea` (shared local)

## Kết luận nhanh

| Phần | Kết luận | Rung |
|---|---|---|
| **A — "Mất trường nhập" tab LCL** | **A1 — RULING GAP**, không phải regression. Field tờ khai CHỈ tồn tại per-container ở bảng "Thông tin hàng" (chỉ render ở tab FCL). Tab LCL không có bảng container (SIL-601: lô LCL không có dòng shipment_containers) và ô cấp lô bị cấm bởi luật SIL-600. Form mở mặc định tab FCL → reporter sáng thấy ở FCL, tối chuyển sang LCL → "mất". | **UI DRIVEN** |
| **B — "Tờ khai không cập nhật vào lô"** | **BUG THẬT, ĐÃ SỬA.** Số tờ khai sống ở 2 store: `shipment_containers.declarationNumber` (per-cont, SIL-521) và `shipment_declarations` (cấp lô). Các aggregate cấp-lô của Điều vận (`loadDeclarationNumbers`) và trang chuyến forwarder (`forwarder-trip-query`) đọc CHỈ store docs → số nhập per-cont (CUS ledger / cell Điều vận / form tạo) không bao giờ hiện ở các mặt đó. Fix: merge 2 store ở mọi aggregate cấp lô (đọc, không ghi — không tạo bản ghi mới, đúng invariant SIL-655). | **UI DRIVEN** (phần A) + **DB/API VERIFIED** (phần B — dispatch surfaces) |

## Phần A — bằng chứng UI DRIVEN (4/4 artifacts)

Form `/shipments/new`, tài khoản CUS `cus` (seed local, theo `testplan/testaccounts.txt`), stack local :7189→:3005:

1. **Screenshot sau khi drive**: `qa/2026-11-02_sil657_ui-fcl-tab.png` (tab FCL mặc định — bảng container CÓ cột `SỐ TỜ KHAI` + ô nhập), `qa/2026-11-02_sil657_ui-lcl-tab.png` (tab Hàng lẻ — KHÔNG có field nào, đúng 3 section: Nhận diện lô / Điểm vận hành & tuyến / Thông tin hàng).
2. **DOM/text assertion** (`qa/2026-11-02_sil657_ui-driver.log`):
   - `ASSERT PASS — form opens on FCL by default — checked=FCL`
   - `ASSERT PASS — FCL table has the SỐ TỜ KHAI column (SIL-701)` + `per-cont declaration input — inputs=1`
   - `ASSERT PASS — LCL tab: 0 "tờ khai" matches on the WHOLE page — matches=0` ← **reproduce đúng nguyên văn báo cáo của reporter**
   - `ASSERT PASS — LCL tab renders no container table (ruling gap A1, not a render bug)`
3. **DB side-effect/state**: `qa/2026-11-02_sil657_db-preproof.log` — cấu trúc 2 store + luật merge trên data thật.
4. **Driver log + exit status**: `qa/2026-11-02_sil657_ui-drive.mjs` · `qa/2026-11-02_sil657_ui-driver.log` · exit **0** (13/13 PASS).

**Không sửa gì phía FE cho phần A** — đây là ruling gap. Việc cần: owner ra luật "lô LCL có cần ô Số tờ khai cấp lô ở form tạo không" (đã đề xuất trong comment ticket; nếu YES, đường Implement sẵn: input ở `ShipmentCreateLclCargoFields` → payload lưu nháp cấp lô → tạo lot row bằng API `shipment-declarations` đã có sẵn — KHÔNG vi phạm SIL-600 vì đó là luật mới của owner).

## Phần B — root cause + fix

### Root cause (chứng minh bằng code)

- Số tờ khai ghi vào `shipment_containers.declarationNumber` bởi: form tạo/sửa (reconcile), CUS line command (CUS ledger, drawer Điều vận, cell kế hoạch chi tiết) — `cus-shipment-workspace-writes.service.ts:554-585`.
- Số tờ khai cấp lô ghi vào `shipment_declarations` bởi `shipment-documents.service.ts` (`upsertShipmentDeclaration`) + fan-out XUỐNG container trống (`syncDeclarationOntoEmptyContainers`, SIL-166) — chiều docs→container ĐÃ CÓ.
- **Chiều container→docs KHÔNG CÓ và các reader aggregate cấp lô chỉ đọc docs**:
  - `loadDeclarationNumbers` (`dispatch-planning-utils.service.ts:501`) — chỉ `shipment_declarations` → feed `GET /api/shipments/dispatch-handoffs` + `docs.declarationNumbers` kế hoạch chi tiết.
  - `forwarder-trip-query.service.ts` (2 site string_agg) — chỉ docs → `ForwarderTripDetailPage` "Số tờ khai" (`/my-forwarder-trips/:id`, route ops-only).
  - `dispatchDetailDataStatusSql` — bit "thiếu tờ khai" chỉ nhìn docs → lô CÓ số per-cont vẫn bị chấm "Thiếu dữ liệu" (trái luật card 261013200312 phía CUS đã OR cả 2 store).
  - (SIL-591 đã vá đúng 1 ô: row FCL trong kế hoạch chi tiết đọc `container.declarationNumber`; các mặt trên bị bỏ sót — cùng lớp lỗi SIL-653.)

### Fix (đọc-merge, không ghi trùng)

1. `dispatch-planning-utils.service.ts` — `loadDeclarationNumbers`: đọc thêm `shipment_containers.declarationNumber`, merge DISTINCT case-insensitive, docs trước (theo id) — đúng luật `distinctDeclarationNumbers` của `cus-workspace-builders.service.ts`. Một hàm →.feed cả dispatch-handoffs lẫn detail-plan.
2. `dispatch-planning-utils.service.ts` — `dispatchDetailDataStatusSql`: bit tờ khai thành `not exists(docs) AND not exists(containers)` — đối xứng luật card 261013200312.
3. `forwarder-trip-query.service.ts` — fragment dùng chung `lotDeclarationNumbersSql` (docs trước, container sau, dedup case-insensitive bằng `row_number() PARTITION BY lower(...)`, bỏ giá trị trắng) wired vào CẢ 2 site; mở rộng search predicate khớp thêm `sc.declaration_number`.
4. Không thêm writer mới, không tạo bản ghi mồ côi (read-side only) — invariant SIL-655 giữ nguyên. Luật ghi FB-109 (fan-out chỉ-fill-trống, clear local) KHÔNG đụng — pin riêng trong test.

### Bằng chứng Part B (DB/API VERIFIED — dispatch surface chưa drive UI)

- **DB pre-proof** (`qa/2026-11-02_sil657_db-preproof.log`): lô 380 `SHP-2610-00215` chứa `TK-631-LONGTEST-VALUE` CHỈ ở container store (`docs_store` NULL); fragment merge trả đúng số cho lô 285 (per-cont-only) và dedup đúng cho lô 204/66 (cả 2 store).
- **API sau fix** (`qa/2026-11-02_sil657_ui-driver.log`): `GET /api/shipments/dispatch-handoffs?q=SHP-2610-00215` (dieuvan, backend :3005 = branch này) → `shipment.declarationNumbers: ["TK-631-LONGTEST-VALUE"]` — trước fix là `[]` (docs-only).
- Forwarder trips endpoint 200/404-sạch (không 5xx) sau merge SQL; lưu ý data local: `user_shipment_links` rỗng nên payload forwarder không resolve lô nào cho user nào — phía forwarder-trip được chứng minh ở mức SQL/psql trên data thật (bằng chứng trong db-preproof) + test pin source-wiring. UI forwarder-trip chưa drive (không có data link local) — ghi rõ ở coverage.

## Test

- Mới: `backend/src/tests/unit/sil657-declaration-number-sync.test.ts` — 7/7 pass (source-wiring scan theo đúng ruling unit-only 19/10: loader đọc cả 2 store, merge order, dedup case-insensitive, data-status OR, fragment 2 site, search predicate, regression guard các luật ghi FB-109).
- Pin cũ giữ nguyên hành vi: full BE suite **342/342** (`qa/2026-11-02_sil657_be-unit-full.log`), FE pins SIL-600/701/502 **5/5** (`qa/2026-11-02_sil657_fe-pins.log`).

## Gates (exact commands + logs)

| Gate | Command | Kết quả | Log |
|---|---|---|---|
| Unit SIL-657 | `cd backend && npx tsx --test --test-concurrency=1 src/tests/unit/sil657-declaration-number-sync.test.ts` | 7/7 pass, exit 0 | `qa/2026-11-02_sil657_be-unit-sil657.log` |
| BE tests (full) | `cd backend && pnpm test` | 342/342 pass | `qa/2026-11-02_sil657_be-unit-full.log` |
| BE typecheck | `cd backend && npx tsc -p tsconfig.json --noEmit` | 0 error, exit 0 | `qa/2026-11-02_sil657_be-tsc.log` |
| FE pins | `cd frontend && pnpm exec vitest run src/features/shipments/create/ShipmentCreateWorkspace.sil600-declaration-column.test.tsx src/features/shipments/create/ShipmentCreateWorkspace.sil502-declaration-draft.test.tsx` | 5/5 pass, exit 0 | `qa/2026-11-02_sil657_fe-pins.log` |
| FE typecheck | `cd frontend && pnpm exec tsc -b` | 0 error, exit 0 | `qa/2026-11-02_sil657_fe-tsc.log` |
| Root lint | `pnpm lint` | 0 errors (7 warnings cũ, không thuộc file lane), exit 0 | `qa/2026-11-02_sil657_lint.log` |
| UI drive | `node qa/2026-11-02_sil657_ui-drive.mjs` | 13/13 PASS, exit 0 | `qa/2026-11-02_sil657_ui-driver.log` |

Build gate `make build` không chạy ở lane (không đụng shared contracts/schema/RBAC/financial calc — chỉ đọc-merge SQL trong 2 service + 1 test file; orchestrator chạy build/merge).

## Verification coverage

| Claim / bug | Rung | Evidence | Not covered |
|---|---|---|---|
| A1: LCL không có field tờ khai — ruling gap, không phải regression | UI DRIVEN | `qa/2026-11-02_sil657_ui-fcl-tab.png`, `qa/2026-11-02_sil657_ui-lcl-tab.png`, driver log 13/13, DB preproof | Viewport mobile 390/768; role khác CUS (DISPATCHER/MANAGER form likewise — cùng code path); staging build khác local |
| B: per-cont number hiện ở mặt Điều vận (dispatch-handoffs) | DB/API VERIFIED | driver log dòng `dispatch handoffs … ["TK-631-LONGTEST-VALUE"]`, db-preproof | Chưa click UI board Điều vận (payload là surface chính board đọc); MẶT besides handoffs của detail-plan dùng cùng `loadDeclarationNumbers` |
| B: forwarder trip page resolve 2 store | DB VERIFIED (psql fragment) + API 200/404 sạch | `qa/2026-11-02_sil657_db-preproof.log` (lô 285), driver log | **UI chưa drive** — `user_shipment_links` rỗng ở DB local nên không có user nào thấy lô; cần QA staging có link thật |
| B: data-status "Thiếu dữ liệu" không còn bật cho lô có số per-cont | CODE-READ ONLY + unit pin | test `MISSING no longer fires…`, `qa/2026-11-02_sil657_be-unit-sil657.log` | Chưa drive chip dữ liệu trên UI kế hoạch chi tiết |
| Pin cũ SIL-600/701/502 không phá | DB/API VERIFIED (test suite) | `qa/2026-11-02_sil657_fe-pins.log` 5/5, BE 342/342 | — |

## Điểm còn sót (cố ý, cần owner/QA)

1. **A1 cần ruling**: LCL có cần ô Số tờ khai cấp lô ở form tạo không? (đề xuất + phương án không vi phạm SIL-600 trong comment ticket). KHÔNG tự thêm.
2. Billing/debit exports (`shipment-debit-summary`, `billing-export-shared`) vẫn đọc docs-only cho `customsNumber` — mặt tài chính, ngoài scope ticket này; nếu owner muốn merge cả đó thì làm ticket riêng.
3. Portal khách (`PortalShipmentDetailPage` "Tờ khai (n)") đọc docs-only qua `getShipmentDetail` — mặt khách hàng; tương tự nên có ruling riêng trước khi merge (số per-cont có muốn hiện cho khách portal không).
4. Driver app: không hiển thị tờ khai (không có surface) — không cần fix.

## Commit

- Branch `fix/sil657-lcl-declaration-field`, push origin. (SHA ghi trong comment ticket sau push.)
