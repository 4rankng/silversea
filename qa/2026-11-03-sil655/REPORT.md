# SIL-655 (id 762) — verification report 03/11 (lane `fix/sil655-orphan-links`)

Base: `origin/main` @ `311473cf` (branch `fix/sil655-orphan-links`, worktree `sil655-fix`).
Brief: `/tmp/sil655-brief-v2.md`. Fix code đã merge trên main qua `bc641ace`
(02/11: link `source_shipment_container_id` ở 5 insert path còn sót + link law
`trip-container-link.service.ts` + invariant test). Lane này = **verify lại từng
path theo code hiện tại + chạy gates số thật + mismatch query trên LOCAL db**.

## 1. Verify từng path của brief (đọc code hiện tại)

| # | Path (brief) | Vị trí hiện tại | Trạng thái |
|---|---|---|---|
| 1 | copyTrip (`trip-create.service.ts:562` cũ) | `trip-create.service.ts:578-594` | ✅ Copy đủ 3 cột link (`sourceShipmentId/ContainerId/Version`); số/seal vẫn reset null theo luật copy. Pinned bởi test `SIL655-01`. |
| 2 | LCL synthetic (`dispatch-planning-commands.service.ts:289` cũ) | `replaceTripContainersForFulfillment:288-301` | ✅ ĐÚNG EXEMPT theo invariant: scope `fulfillment.shipmentContainerId == null` tạo row **containerNumber null** + marker `__fulfillment_lcl:<id>`, không forge link. Lô LCL bị cấm có container ở 2 điểm enforcement (decomposition + intake, 409) ⇒ số không bao giờ resolve được ⇒ số ghi lên row này bị từ chối tường minh (REJECT_UNDECLARED), không im lặng. **Không đụng file này** (đúng điều kiện ưu tiên của brief AC5 — tránh đụng độ với lane SIL-668 đang chạy song song trên cùng khu vực). FCL path (:312-327) set đủ link. |
| 3 | Placeholder khi tạo trip (`trip-create.service.ts:489` cũ) | `trip-create.service.ts:488-514` | ✅ Placeholder chỉ insert khi lô CHƯA có container (hoặc trip không thuộc lô); row placeholder **số-rỗng** ⇒ exempt. Luồng lái xe nhập số vào row chưa-link: resolve-by-lot lúc update — PATCH `updateTripContainerInClient:293-305` + batch PUT `batchUpsertTripContainers:614-625` đều `decideTripContainerNumberLink` → LINK set link ngay, rồi bridge mirror về lô. Pinned bởi `SIL655-02/05`. |
| 4 | Forwarder insert điều vận (`forwarder-container.service.ts:104` cũ) | `createTripContainerInClient:165-196` | ✅ Resolve-or-throw TRƯỚC insert: số không khai trên lô → 409; số khớp → insert kèm link + chạy bridge `syncShipmentIdentityFromTripContainers`. Pinned bởi `SIL655-03`. |
| 5 | (`forwarder-container.service.ts:489` cũ) | PATCH `:287-305` + batch `:586-642` | ✅ Như trên: row chưa-link có số → resolve-or-throw; row đã-link giữ semantics SIL-653. Pinned bởi `SIL655-03/05` + batch test. |

### Quét TOÀN BỘ insert site `trip_containers` (8/8 — không còn path sót)

| Insert site | Link? |
|---|---|
| `shipment-containers.service.ts:171` (snapshot vào trip) | ✅ set `sourceShipmentContainerId: c.id` (:161) |
| `dispatch-planning-commands.service.ts:289` (LCL synthetic) | exempt — số-rỗng theo luật |
| `dispatch-planning-commands.service.ts:312` (FCL fulfillment) | ✅ set link (:315) |
| `trip-create.service.ts:504` (placeholder) | exempt — số-rỗng + gated lô-rỗng |
| `trip-create.service.ts:578` (copyTrip) | ✅ copy link từ dòng nguồn |
| `seed/seed-bulk-data.ts:715` (seed) | ✅ set `sc.id` (:718) |
| `forwarder-container.service.ts:187` (POST thêm cont) | ✅ resolve-or-throw + link |
| `forwarder-container.service.ts:633` (batch PUT) | ✅ resolve-or-throw + link + reserved-set |

## 2. Invariant + carve-out (nêu rõ theo yêu cầu brief)

Law: mọi `trip_container` **CÓ số** trên chuyến thuộc lô phải resolve về đúng 1
`shipment_containers` (cùng số) — hoặc write bị **từ chối tường minh 409**.
Service layer enforce resolve-or-throw (không phải warn-log): 409 chặn mồ côi
tại chỗ sinh ra, mạnh hơn warn-log (warn-log vẫn để lại row vi phạm). Decision
law là pure function `decideTripContainerNumberLink`
(`trip-container-link.service.ts`), test ở
`backend/src/tests/unit/sil655-trip-container-link-invariant.test.ts` (228 dòng,
đã có từ bc641ace — gồm mismatch-law + source-wiring scan theo đúng convention
unit-only 19/10).

**Carve-out đặc thù (documented, invariant vacuous):**
1. Trip KHÔNG thuộc lô (`trips.shipment_id IS NULL`) — không có gì để resolve;
   số giữ trip-local (NO_SHIPMENT). Nhắc trong test + comment code.
2. Lô LCL lawfully không có container (2 điểm 409) — row synthetic `__fulfillment_lcl:`
   luôn số-rỗng; số ghi lên nó bị 409, không bao giờ thành row mồ côi có số.
3. Row số-rỗng (placeholder/synthetic) không cần link — không vi phạm invariant.

## 3. Gates — số thật

| Gate | Command | Kết quả | Artifact |
|---|---|---|---|
| Scoped unit (invariant + bridge + batch schema + SIL-638 round-3 point-claim/warn-once/auto-pair-SIL-668) | `cd backend && npx tsx --test --test-concurrency=1 <7 file: sil655 + sil653 + qa060 + sil638-b2-tc1-tc2-guards + sil638-tc1-busy-rig-warn + sil638-b2-auto-pair + sil666>` | **94 tests, 94 pass, 0 fail** (exit 0) | `2026-11-03_sil655_scoped-unit-gate.log` |
| Backend typecheck (canonical AGENTS.md form) | `cd backend && npx tsc --noEmit` | **0 errors** (exit 0) | `2026-11-03_sil655_tsc-noemit.log` |
| Mismatch query invariant trên LOCAL db | `docker exec ss-prod-db psql …` (localhost:5441) | **0 rows** (mismatch) + **0 rows** (orphan-with-number); 366/366 row có-số đều có link; 41 row số-rỗng (exempt); tổng 407 | `2026-11-03_sil655_mismatch-query-localdb.log` |

Lưu ý môi trường cho lane sau (quan trọng):
- Lệnh `pnpm exec tsc -p backend/tsconfig.json --noEmit` chạy TỪ ROOT của brief
  resolve nhầm TypeScript **6.0.3** (root) thay vì **5.9.3** (backend pin) và
  báo 2 error TS2871 pre-existing tại `shipment-detail-reads.service.ts:221/223`
  — **đã xác chứng là có sẵn trên pristine origin/main VÀ 41c75c08** (git
  archive + tsc trong scratch dir): `2026-11-03_sil655_tsc-at-41c75c08.log`.
  Gate chuẩn theo AGENTS.md (`cd backend && npx tsc --noEmit`, TS 5.9.3) = green.
  2 diagnostics TS6 này là việc của lane khác, không thuộc scope SIL-655.
- Fresh worktree cần `pnpm install --frozen-lockfile` + `pnpm --dir shared build`
  trước khi chạy test (shared/dist thiếu ⇒ ERR_MODULE_NOT_FOUND).
- Lane SIL-668 chạy song song đã ghi file tạm vào worktree này
  (dispatch-planning/trip-pair* + sil638-b2-auto-pair.test) rồi tự revert; mọi
  gate ở trên chạy khi tree clean, và lane này KHÔNG đụng file nào của nó.

## 4. AC checklist (brief)

1. ✅ CopyTrip giữ link — code + test `SIL655-01` (bc641ace); số/seal vẫn null theo luật cũ.
2. ✅ Forwarder paths có link khi map được; carve-out NO_SHIPMENT + LCL documented ở §2.
3. ✅ Placeholder/LCL-synthetic số-rỗng exempt; lái xe nhập số vào row chưa-link → resolve-by-lot lúc update (PATCH/batch) + bridge sync về lô — test `SIL655-05`.
4. ✅ Mismatch query 0 row trên local db (log ở trên). 2 row legacy tc 12/17 của baseline 02/11 đã hết (backfill SIL-653 do orchestrator chủ trì đã xử lý trước giờ chạy).
5. ✅ Không regress: bridge SIL-653 pins xanh; SIL-638 point-claim + warn-once xanh; auto-pair SIL-668 pins xanh; KHÔNG đụng `dispatch-planning-commands.service.ts` (path 2 đúng exempt).

## 5. Phạm vi thay đổi của lane này

KHÔNG có thay đổi code (fix đã nằm trên main). Commit = qa artifacts
(force-add `qa/2026-11-03-sil655/`) + push branch `fix/sil655-orphan-links`.
