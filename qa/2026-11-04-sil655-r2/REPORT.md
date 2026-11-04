# SIL-655 round-2 (id 762) — API-level execution evidence for the 4 non-UI insert paths

Lane: branch `test/sil655-r2-path-probes` (this repo/worktree), base `origin/main` @ `386477c` (bc641ace merged — code untouched, **0 src changes**).
Date: 2026-11-04. Brief: `/tmp/sil655-r2-brief.md`. Round-1 (static verify): `qa/2026-11-03-sil655/REPORT.md`.
Strict rule being answered: QA đếm FAIL các insert path KHÔNG có bằng chứng THỰC THI — lane này thực thi từng path trên LOCAL dev và in bằng chứng (a) row id, (b) `source_shipment_container_id` đọc lại từ db, (c) bridge / số-về-lô, (d) mismatch query (issue 762, verbatim) = 0 row sau flow.

## Environment

- LOCAL dev stack: docker `ss-prod-db` → localhost:5441/silversea (psql `-U postgres`), docker `ss-prod-redis` :6391. KHÔNG đụng staging/prod.
- Drivers: `qa/scripts/2026-11-04-sil655-r2-{lib,p0-baseline-repair,p1-seed-path-probe,p2-copytrip-link-probe,p3-forwarder-post-probe,p4-batch-put-probe}.mjs`, chạy bằng `cd backend && npx tsx ../qa/scripts/<file>` (service-level drivers gọi thẳng hàm service thật mà route gọi — cùng insert path, không qua HTTP).
- Backend deps: pnpm install + `pnpm --dir shared build` trước khi chạy (fresh worktree).
- DB là db dùng chung của máy → total counts trôi giữa các run (470↔471); các assert của probe không dựa vào global count, chỉ vào mismatch query + row scoped theo fixture.
- Mismatch query (verbatim từ issue 762) + orphan-with-number query in nguyên văn trong MỖI log — kết quả `(0 rows)` sau flow.

## Bảng 4 path × kết quả

| # | Path (điểm insert) | Driver | Thực thi | (a) row id | (b) link set | (c) bridge / số về lô | (d) mismatch sau flow |
|---|---|---|---|---|---|---|---|
| 1 | seed — `seed/seed-bulk-data.ts:715-718` (trips segment) | `p1-seed-path-probe.mjs` | ✅ wipe BULK scoped (local) → `seedBulkData()` thật, 2s: +250 shipments/+185 trips/+229 trip_containers | sample 5 ids in log | **229/229** row có-số đều có `source_shipment_container_id` | số tc == số sc trên 100% row seeded (0 lệch); seed ghi 2 bên nhất quán trực tiếp (không gọi bridge) | **Q1 = 0 row, Q2 = 0 row** |
| 2 | copyTrip — `trip-create.service.ts` (`copyTrip` insert trip_containers) | `p2-copytrip-link-probe.mjs` | ✅ `copyTrip(52)` trên source tạm CANCELED (fixture local, restore+verify sau) → trip copy 878 | copy tc ids 794/795 | link-set parity: `sc#272` copy y hệt source; placeholder copy giữ link-NULL như source | mọi copied row **số-rỗng + seal-rỗng** đúng luật copy; lô không bị ghi (bridge vacuous hợp lệ) | **Q1 = 0 row, Q2 = 0 row** |
| 3 | forwarder POST thêm cont — `forwarder-container.service.ts:141` `createTripContainerInClient` | `p3-forwarder-post-probe.mjs` | ✅ `createTripContainer` số khớp lô (input lowercase có space → normalize) | tc id=788 (run cuối: in log) | `source_shipment_container_id=sc#1466-class` + `source_shipment_id` + number canonical | bridge GHI được chứng minh: seal `SIL655R2-SEAL1` mirror lên sc của lô (trước đó NULL); số lô == số tc | **Q1 = 0 row, Q2 = 0 row** |
| 4 | forwarder batch PUT — `forwarder-container.service.ts:528` `batchUpsertTripContainers` | `p4-batch-put-probe.mjs` | ✅ batch 1 row có số + `expectedVersion` → insert; **negative**: batch số không khai → 409 + rollback TOÀN VẸN (row tốt còn nguyên, version không nhảy) | tc id=800 | `source_shipment_container_id=sc#1466-class` | bridge mirror seal `SIL655R2-BATCH` lên sc lô; số lô == số tc; `trips.version` 1→2 | **Q1 = 0 row, Q2 = 0 row** |

Tổng check: p0 2/2 · p1 **9/9** · p2 **22/22** · p3 **17/17** · p4 **16/16** — exit 0 hết. Negative arms: undeclared → `ApiError 409 "chưa được khai trên lô hàng của chuyến."` (p3+p4), duplicate-on-trip → `ApiError 409 "đã có trên chuyến này."` (p3); p3+p4 đều assert KHÔNG có row nào được lưu sau 409.

## Preflight p0 — ambient baseline repair (bằng chứng bắt buộc để gate (d) đọc sạch)

Db local đã bị restore về snapshot cũ sau round-1: 2 row legacy `trip_containers` **12, 17** (cùng 2 id mà round-1 ghi nhận backfill SIL-653 đã xử lý trước 03/11) quay lại vi phạm Q1 — sc 13/45 có `container_number` NULL trong khi tc có số. Đây KHÔNG phải row do 4 path sinh ra (timestamps 09/10–13/10, trip `TRP-2026*`). p0 chạy repair bằng **code bridge chuẩn** `syncShipmentIdentityFromTripContainers(tx, [12,17])` (đúng semantics SIL-653, không SQL tay), sau đó Q1 = 0 row. `p0-baseline-repair.log` cuối = noop 2/2 (baseline giữ sạch).

## Phát hiện Escalate (KHÔNG thuộc SIL-655 — lane này không sửa src)

**copyTrip chết ở execution-level cho MỌI trip lot-linked còn LIVE.** Copy clone `shipment_id`, `fulfillment_id`, `active_trip_pair_id/order` (COPY_EXCLUDED_TRIP_FIELDS, `trip-mutations-shared.service.ts:93` không exclude cột nào trong 3 cặp đó) và reset status `CREATED` (live) ⇒ insert đụng unique index:

| loại source | constraint | repro trong log |
|---|---|---|
| trip đang trong cặp xe active | `trips_active_trip_pair_order_uniq` | run đầu p2 (bị thay bằng pair-free selection) |
| trip có fulfillment | `trips_fulfillment_id_live_uniq` | run p2 trên trip 851 (fulfillment 1453) |
| trip lot-linked thường | `trips_shipment_without_fulfillment_live_uniq` | **arm 0 của p2 (trong log cuối)**: trip 52 CREATED → `DrizzleQueryError` 23505 |

Route `routes/trips/crud.ts:89 → copyTripWriteCommand → copyTripCommand` KHÔNG có guard → **"Sao chép chuyến" trên trip live thuộc lô = 500 chưa bắt**. Lớp preconditions duy nhất copy chạy được: source CANCELED (copy thành sole-live-trip của lô) — p2 đã thực thi dưới precondition đó và link law copy ĐÚNG. Đây là defect class khác (feature copy hỏng cho live trips), KHÔNG phải mồ côi container — escalate cho owner/QA quyết lane fix riêng. KHÔNG tự fix.

Ghi chú phụ: guard idempotency (a) của seedBulkData query marker trên `blNumber` (:290) nhưng seed ghi marker vào `bookingRef` (:510) ⇒ guard (a) dead code; guard (b) (`BULK-%` LIKE) chịu trách nhiệm thật. Không sửa (nằm ngoài scope, không gây sai lệch — guard (b) phủ được marker vì `booking_ref LIKE 'BULK-%'`).

## Gates — số thật

| Gate | Command | Kết quả | Artifact |
|---|---|---|---|
| Probe drivers (p0+p1+p2+p3+p4) | `cd backend && npx tsx ../qa/scripts/2026-11-04-sil655-r2-*.mjs` (từng file) | **66/66 checks pass, exit 0** (2+9+22+17+16) | `p0-*.log` `p1-*.log` `p2-*.log` `p3-*.log` `p4-*.log` |
| Backend typecheck | `cd backend && npx tsc --noEmit` | **0 errors** (exit 0) | `tsc-noemit.log` |
| Mismatch query trên local sau flows | trong mỗi driver, verbatim issue 762 | **0 row** (Q1 + Q2) sau TỪNG flow | các `*.log` |
| BE unit mới | không viết thêm — law đã pin từ bc641ace (`sil655-trip-container-link-invariant.test.ts`); lane này là execution drivers theo đúng phân chia unit-only/integration (AGENTS §2 19/10: db-bound → qa/scripts) | — | — |

## Phạm vi thay đổi của lane

KHÔNG sửa src. Commit = drivers `qa/scripts/2026-11-04-sil655-r2-*.mjs` + evidence `qa/2026-11-04-sil655-r2/` (force-add qua gitignore). Db local để lại: dataset BULK re-seeded (fresh, đúng mục đích dev db), legacy tc 12/17 được bridge về đúng law. Không còn row fixture nào (`SIL655R2%` = 0, copy trips đã xóa, trip 52 về CREATED).
