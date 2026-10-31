# SIL-638 (id 742) — BE lane: guard laws cho TC1 / TC2 / TC3 / TC6 / TC7

Ngày: 2026-10-31 · Branch: `fix-sil-638-be` · Nguồn chuẩn: DOC
`logic-hang-kep-kethop` (đính kèm ticket SIL-638; ticket v2 31/10 theo ruling
Frank). Ticket paraphrase TC6/TC7 khác DOC — **tuân theo DOC**.

## Phạm vi BE đã làm

| TC | Nội dung BE | Guard hiện tại | Thay đổi |
|----|-------------|----------------|----------|
| TC1 | Xe chạy nhiều lệnh ĐƠN cùng ngày KHÁC khung giờ = ĐƯỢC; trùng khung giờ hoặc xe Đang chạy = chặn | Đã đúng theo time-scoped availability guard (`assertResourceAvailability`, `assertPlanRowRigAvailable`) | Unit pin luật cửa sổ: `tripClaimWindowOverlaps` (strict overlap, holder mở end = +8h) — `sil638-tc1-single-rig-time-windows.test.ts` |
| TC2 | Cont A Kẹp + Cont B ĐƠN gán chung xe → từ chối | ĐÃ CHẶN CỨNG sẵn: phát lệnh ĐƠN lên xe đang giữ Kẹp → mode carve = null → `blocking` giữ nguyên → 409 "Xe đầu kéo đã bị trùng lịch kế hoạch." (plan-save cũng 409 hard khi evidence mạnh) | Pin tầng quyết định pure: `declaredKepShareMode` / `isDeclaredKepSharePartner` / `isMixedDeclarationKepCandidate` — `sil638-tc2-kep-vs-don-incompatibility.test.ts`. Không đổi message (dis-03 card 211026131857 giữ nguyên: chiều phát KẸP lên xe đang có ĐƠN là confirmable warn theo owner ruling — không reopen) |
| TC3 | 2 DOUBLE → pair tự tạo + VETC 1 lần + lương phụ phí kẹp | Pair qua POST /trips/pairs; VETC dedup + pair salary đã có | Pin pure: `backhaulTollDeductionForSecond` + `pairSurchargeFor` — `sil638-tc3-pair-vetc-salary.test.ts`. GAP ghi nhận: pair tạo bằng dialog/manual qua /trips/pairs, không có auto-pair hoàn toàn lúc issue — chưa tự implement billing (theo brief) |
| TC6(1) | Cont 40' kẹp = CHẶN CỨNG, đúng text DOC | Đã chặn ở createTripPair nhưng message cũ "Không đủ điều kiện kẹp hàng: kẹp hàng yêu cầu 2 container 20ft..." | Đổi sang text DOC: **"Cặp kẹp chỉ áp dụng cho đúng 02 container loại 20ft"** (hard 422, cả shell không khai loại vẫn chặn). FE test PairTripsDialog cập nhật kỳ vọng message |
| TC6(2) | Tải trọng vượt = CẢNH BÁO MỀM + confirm tiếp tục lưu | 409 CỨNG "Tổng trọng lượng hai container kẹp vượt quá tải trọng xe." tại 3 điểm carve | Đổi sang warn-once: 409 **`KEP_WEIGHT_WARNING`** + text DOC "Tổng tải trọng hàng ước tính có thể vượt tải trọng cho phép của phương tiện, Điều vận vui lòng kiểm tra lại"; retry mang flag body **`kepWeightWarningConfirmed=true`** thì lưu tiếp. Flag đi qua: core.routes issue schema → `issueOrderCreateOrUpdate` → `assertResourceAvailability` |
| TC7(1) | Ghép COMBINED lệch kích cỡ → chặn | Trước đây chỉ rule số vỏ; chưa có rule kích cỡ | Thêm gate: khác size (20 vs 40) → 422 **"Hàng kết hợp yêu cầu 2 lệnh phải có cùng kích cỡ container (cùng 20' hoặc cùng 40')"**; 40'+40' ĐƯỢC; thiếu size → skip (quy ước bổ sung sau như rule số vỏ) |
| TC7(2) | Tự động kế thừa Số Container Lệnh 2 ← Lệnh 1 | Không có | Khi pair KET_HOP tạo thành công và Lệnh 2 trắng số vỏ → ghi số vỏ Lệnh 1 vào `trip_containers` (snapshot) + `shipment_containers` (row lot, qua fulfillment) — chỉ ghi đè giá trị TRỐNG |
| TC7(3) | VETC 1 lần | Đã có (cùng cơ chế TC3, áp cho cả KET_HOP) | Pin trong `sil638-tc7-combined-size-inherit.test.ts` |

## File BE

- `backend/src/services/trip-pair-rules.service.ts` — MỚI, thuần pure (không db — đúng ruling BE unit-only 19/10): text DOC, `containerFootClass`, size gates, `containerNumberToInherit`, `kepPairWeightVerdict` + `kepWeightGuardOutcome`, `tripClaimWindowOverlaps`, share predicates (tách nguyên văn từ guard), toll dedup + `pairSurchargeFor` (move từ pair-salary-settings, re-export giữ tương thích).
- `backend/src/services/dispatch-resource-availability.service.ts` — 3 điểm weight hard 409 → `KEP_WEIGHT_WARNING` confirmable; điều kiện carve gọi pure predicates (semantics giữ nguyên).
- `backend/src/services/trip-pairs.service.ts` — KEP size text DOC; KET_HOP size gate; kế thừa số vỏ.
- `backend/src/routes/shipments/core.routes.ts` + `backend/src/services/dispatch-planning-commands.service.ts` — flag `kepWeightWarningConfirmed` (schema + forward).
- FE: `frontend/src/features/dispatch/detailed-plan/PairTripsDialog.test.tsx` — chỉ cập nhật kỳ vọng message mock (FE dispatch, không đụng driver app FE).

## Tests (node:test — convention repo; thư mục unit-only)

`backend/src/tests/unit/sil638-tc{1,2,3,6,7}-*.test.ts` — 42 tests, all pass.

## Gates đã chạy (2026-10-31, worktree fix-sil-638-be)

| Gate | Kết quả |
|---|---|
| `cd backend && npx tsc --noEmit` | 0 error |
| `cd backend && pnpm test` | 338/338 pass |
| `cd frontend && npx tsc -b` | 0 error |
| `cd frontend && npx vitest run PairTripsDialog.test.tsx` | 3/3 pass |
| `pnpm lint` | 0 error (8 warning cũ, ngoài phạm vi) |
| `make build` | thành công |

Lần chạy đầu `pnpm lint` FAIL 1 error (`no-unused-vars` trong test TC2 mới — biến `kepHolder` thừa sau sửa test); đã sửa, rerun 0 error. Artifacts: `qa/2026-10-31_sil638-be_*.txt`.

## Independent review (code-reviewer, 31/10) — DONE_WITH_CONCERNS, 0 blocker

- F2/F5 (chấp nhận có chủ đích, non-issue): `containerFootClass` trim code trước so sánh (catalog code sạch; lệch trim không thể chạm được với dữ liệu danh mục). Writer kế thừa chỉ ghi đè NULL/'' — số vỏ lưu toàn whitespace (dữ liệu rác) không được stamp, không rủi ro ghi đè.
- F3 (đã fix commit review): nguồn kế thừa TC7(2) fallback sang row lot (`shipment_containers`) khi snapshot `trip_containers` của Lệnh 1 trắng số vỏ (CUS bổ sung số vỏ sau khi phát lệnh) — `lotContainerNumberForTrip`.
- F4 (cho lane FE): trên nhánh dis-03 (phát KẸP 20' lên xe đang có ĐƠN), confirm tải trọng phải gửi CẢ HAI flag `kepWeightWarningConfirmed` + `rigOverlapCompletedConfirmed`.
- F7 (đã xác nhận): text TC7(1) khớp nguyên văn ticket SIL-638 (đã fetch ticket id 742).
- F1 (đã ghi ở "Coverage còn thiếu"): FE confirm dialog là nửa còn lại của hợp đồng DOC TC6(2).

## Coverage còn thiếu (nêu rõ)

- **Integration/E2E** cho TC1/TC2/TC6 flow thật (trang điều phối + phát lệnh): thuộc QA scripts (`testplan/qa/scripts/`) chạy trên local dev — lane này chỉ pin tầng pure theo ruling BE unit-only; UI chưa được drive (rung 1 cho UI claims).
- FE toast/confirm dialog cho `KEP_WEIGHT_WARNING` (text + nút xác nhận gửi `kepWeightWarningConfirmed=true`) — chưa có, cần lane FE dispatch.
- Driver app FE (TC4/TC8/TC9) — lane D2.
- Auto-pair hoàn toàn lúc issue (TC3 "tự động gom") — gap ghi nhận, chưa implement.
