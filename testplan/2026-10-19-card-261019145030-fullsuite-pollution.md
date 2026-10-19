# Card 261019145030 — BE full-suite pollution: ad-hoc-orders mixed-row + Q20 completion-date

Ngày: 2026-10-19 · Card: 261019145030 · Worktree:
`fix-261019145030-fullsuite-pollution-rb1` (base main `be127c59`).

## Chẩn đoán (evidence)

Full suite SOLO theo lệnh gate 3 (`tsx --test "src/tests/**/*.test.ts"`, node:test
mặc định chạy FILE SONG song — `ps` cho thấy nhiều child `node --test-concurrency=0`
cùng lúc; `pg_stat_activity` ≈ 39 connection trên cùng dev DB):

3367 tests / 3365 pass / 2 fail; cả 2 file PASS khi chạy riêng (7/7 và 2/2) →
nhiễu cross-file trên DB dùng chung, không phải regression runtime. Lớp lỗi trùng
`testplan/2026-10-19-be-reds-final-cross-run-interference.md` (REDS-CONC-01..05).

Mỗi cơ chế đã được REPRODUCE tất định bằng interferer có chủ đích (script
throwaway trong temp phiên, không commit; driver log + transcript:
`qa/2026-10-19_card-261019145030_repro-*.log`):

1. `ad-hoc-orders.test.ts` "mixed row: free-text customer + catalog route id"
   — **P1 (đã reproduce, đỏ)**: guardrail `masterCounts()` đếm whole-company
     `customers/operational_sites/routes/ports` ở `before()` rồi deepEqual lại
     ở từng test; suite khác chèn/dỡ fixture catalog vào cửa sổ giữa 2 lần đếm
     → deepEqual gãy (diff thực: customers '9001' → '8998'). Test nào dính
     trước thì đỏ theo timing — lần gốc là mixed-row, lần reproduce là test 1.
   — **P2 (cùng lớp, racer thưa hơn)**: mixed-row chọn route bằng
     `.limit(1)` không ORDER BY trên catalog dùng chung — row có thể là
     fixture của suite khác; teardown bên kia xóa nó giữa lúc select và POST
     thì `assertShipmentMasterRefsExist` ném 400 "Tuyến vận chuyển không
     tồn tại." → `status === 201` đỏ.
2. `q20-official-reporting-periods.test.ts` "completion date drives P&L,
   dashboard, fuel variance..." — **P3 (đã reproduce, đỏ 2/8 vòng dưới
   stress 3 interferer)**: các pin delta snapshot TOÀN CÔNG TY
   `dashboardAfter.tripCount >= dashboardBefore.tripCount + 1` ( dòng 346,
   "dashboard official trip count must include the completed cross-period
   trip") và `dashboardAfter.inTransitTrips >= dashboardBefore.inTransitTrips
   + 1` (dòng 350, "in-transit trips remain operationally visible but stay
   outside official trip totals") — `dashboardBefore` chụp ở `before()`,
   teardown của suite khác xóa trip COMPLETED-in-period / IN_TRANSIT của họ
   trong cửa sổ vài trăm ms giữa 2 lần đọc → tổng rớt → đỏ.
   — **P4 (cùng lớp)**: fleet bracket `liveFleetBefore <= totalTrucks <=
   liveFleetAfter` gãy tương tự khi truck fixture của suite khác bị dỡ
   trong cửa sổ query dashboard.
   Các pin membership theo tripCode/truck riêng của suite (P&L, fuel
   variance, quarterly distribution, fuel-ap-recon) đã hermetic — không đổi.

## Cases

### POLL-261019145030-01 — ad-hoc guardrail toàn công ty + route dùng chung
- Reproduce (đã làm, đỏ): chạy `tsx --test src/tests/ad-hoc-orders.test.ts`
  đồng thời interferer chèn/xóa 40 route + 3 customer mỗi ~130ms → guardrail
  deepEqual đỏ (P1); window trúng select→POST → 400 (P2, racer cùng lớp).
- Expected (đã fix): guardrail pin đúng nghĩa AC5 ("free text KHÔNG BAO GIỜ
  leak vào master catalog") nhưng scope theo TÊN raw mà suite này submit —
  absolute zero-count trên 4 bảng catalog theo đúng bộ tên đã submit (precedent
  REDS-CONC-03: pin scope theo data của suite, không đếm whole-company); việc
  nào leak từ run bất kỳ (kể cả cross-run cùng file) vẫn bắt được. Mixed-row
  dùng route fixture DO SUITE TẠO (`AdHoc route <suffix>`, insert ở before,
  dỡ ở after) — không còn `.limit(1)` trên catalog dùng chung. Giá trị XOR
  (routeId set ⟺ rawRouteName null) vẫn pin đầy đủ qua catalog id thật.
- Verify: 5/5 vòng xanh dưới cùng interferer đã đỏ pre-fix; isolated 7/7.
- Files: `src/tests/ad-hoc-orders.test.ts`.

### POLL-261019145030-02 — q20 dashboard delta/bracket toàn cục
- Reproduce (đã làm, đỏ 2/8 vòng): 3 interferer churn truck + trip
  COMPLETED-in-period + trip IN_TRANSIT; đỏ đúng 2 pin dòng 346/350.
- Expected (đã fix, v2 — bracket + settle): giữ NGUYÊN Ý pin ("trip hoàn
  thành của tôi TÍNH vào official count; trip in-progress KHÔNG, chỉ hiện
  operational"), đọc theo cách miễn nhiễm churn ngoài:
  1. membership tất định: `countTripInOfficialWindow(myTrip)` — predicate
     CHÍNH XÁC của dashboard (not deleted, COMPLETED, business completion
     date ∈ kỳ lương hiện hành [start, end-exclusive) qua
     `salaryPeriodDateRange` + `tripCompletionBusinessDateSql` của
     reporting-shared) → completed = 1, in-progress = 0;
  2. read-time consistency BRACKET: mỗi vòng đọc — đếm độc lập TRƯỚC, bust
     cache `reports:dashboard`, đọc dashboard, đếm độc lập SAU — mỗi con số
     dashboard phải nằm trong bracket [before, after] của chính nó (churn
     growth — lớp chủ yếu dưới full-suite song song — được bracket hấp
     thụ); teardown rơi vào trong cửa sổ làm gãy bound thì RETRY tối đa 3
     lần (precedent REDS-CONC-04: divergence thật — sai window, decode sai,
     double-count — nằm ngoài mọi bracket, fail hết các lần và assertion
     cuối hiện số thật).
  Lưu ý thiết kế (bài học từ lần chạy full đầu tiên): dạng EQUALITY tuyệt
  đối dashboard == independent ĐỎ dưới full-suite thật (dashboard 1128 vs
  independent 1131 — các suite song song giữ truck/trip fixture sống vài
  giây rồi dỡ, growth bền trong cửa sổ đọc ~1s) → phải dùng bracket như
  thiết kế gốc của tác giả test, cộng settle-retry. Fleet pin giữ nguyên
  dạng bracket gốc; các pin decode (typeof, totalTrucks = Σ fleetStatus,
  executive undefined, lockedTrips vestigial 0) giữ nguyên. Không đổi
  service, không đổi product.
- Verify: 8/8 vòng xanh dưới stress 3 interferer churn thưa (đã đỏ pre-fix
  2/8); 8/8 vòng xanh dưới 3 interferer create-hold-delete bền (2 truck +
  8 trip/vòng, hold ~0.3-1s — mô phỏng lifecycle suite thật, dạng đã làm
  đỏ equality-form); isolated 2/2; full-suite gate 3: 2/2 target xanh.
- Files: `src/tests/q20-official-reporting-periods.test.ts`.

## Phạm vi fix

Chỉ test infrastructure của 2 file nạn nhân (fixture scoping + cách đọc pin).
Không đổi assertion semantics của invariant nghiệp vụ, không đổi product code,
không đụng suite khác.

## Not covered

- Các suite khác vẫn có thể đỏ dưới full-suite song song/cross-run (đã thấy
  accounting-transport-register đỏ trong lần chạy full này — ngoài scope card,
  liệt kê trong báo cáo, không fix).
- Full-suite sạch chỉ có ý nghĩa khi không có tiến trình test khác cùng chạy
  trên dev DB (caveat kế thừa từ testplan 2026-10-19-be-reds-final).
