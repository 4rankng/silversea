# SIL-894 — K-eligible QA seed cho điểm K /timesheet/bao-cao 11/2026 (staging vantai)

Muse QA SIL-894 (`/timesheet/bao-cao` + `/timesheet`, tháng 11/2026) chặn ở
điểm K vì "zero K cells anywhere in the Nov 2026 bao-cao grid; no driver-day
has a system-suggested K cell". Doc này là evidence verbatim cho lần seed
tháo chặn đó — data-only, Timesheet code không đổi.

## Luật được seed

`shared/src/calculations/timesheetSalary.ts` — `timesheetSymbolForDay`
(SIL-884 5.2 / CR-010): 2 chuyến hoàn thành cùng ngày kinh doanh của cùng lái
xe mang CÙNG số cont (1 Nhập + 1 Xuất chung số cont 40', cặp Kết hợp) → ô
ngày `K`, `source = 'AUTO'` ("Hệ thống tự gợi ý"), CHUYẾN 2→1
(`K.summaryTrips = 1`) và Tổng lệnh kẹp +1.

Ô chấm công KHÔNG ghi tay: `backend/src/seed/seed-qa-k-eligible.ts` gọi service
`syncTimesheetSymbolForTrip` của hệ thống (cùng code engine hoàn thành chuyến
gọi) — ô là gợi ý thật, kèm audit "Tự ghi ký hiệu chấm công K ngày …".

## Đã seed (staging vantai.tingting.vip)

- Lái xe: **Nguyễn Duy Tuấn (driver_id=3, FLAT_MONTHLY, xe 15E-016.26/truck 1)**
  — data có sẵn trên staging (không tạo driver mới).
- Ngày: **2026-11-18** (Thứ Tư) — kỳ 11/2026, tháng OPEN.
- Container: **QATU8940040** — cùng số cont trên cả 2 lệnh (input của luật ghép).
- Rows QA-marked (purge được bằng `make qapurge`, ẩn khỏi phơi phiếu bởi
  `qa-fixture-markers`): lô `QA-SIL894-K` (KH `QA KH SIL-894`/`QASIL894KH`
  tạo mới vì staging chưa có KH QA — tên mang dấu 'QA'), 2 lệnh
  `shipment_fulfillments` COMBINED (ids 1098, 1099), 2 chuyến
  `QA-SIL894-K1`/`QA-SIL894-K2` (trips 551, 552, COMPLETED, completed_at
  02:30Z/08:30Z = 09:30/15:30 +07 cùng ngày), 2 `trip_containers` cùng số cont,
  1 cặp `trip_pairs` KET_HOP (id 47).

## Seed invocation (staging)

Build tại local (`pnpm --dir backend build`), copy 1 file vào backend container
chạy sẵn (không deploy, image không đổi):

```text
scp backend/dist/seed/seed-qa-k-eligible.js root@vantai.tingting.vip:/tmp/
ssh root@vantai.tingting.vip 'cd /opt/vantai && docker compose -f deploy/docker-compose.prod.yml run --rm --no-deps -e KSEED_ENV=staging -v /tmp/seed-qa-k-eligible.js:/prod/backend/dist/seed/seed-qa-k-eligible.js backend node dist/seed/seed-qa-k-eligible.js'
```

Output verbatim:

```text
KSEED-TARGET driver=Nguyễn Duy Tuấn(id=3) truck=1 customer=42 route=6 day=2026-11-18 cont=QATU8940040
KSEED-SEED shipment=QA-SIL894-K(1158) fulfillments=1098,1099 trips=551,552 pair=47
KSEED-SYNC WRITTEN symbol=K workDate=2026-11-18 wrote=true
KSEED-SYNC WRITTEN symbol=K workDate=2026-11-18 wrote=true
KSEED-VERIFY trips (input shape):
  {"id":551,"trip_code":"QA-SIL894-K1","status":"COMPLETED","completed_at":"2026-11-18 02:30:00","business_date":"2026-11-18","container_number":"QATU8940040","pair_kind":"KET_HOP"}
  {"id":552,"trip_code":"QA-SIL894-K2","status":"COMPLETED","completed_at":"2026-11-18 08:30:00","business_date":"2026-11-18","container_number":"QATU8940040","pair_kind":"KET_HOP"}
KSEED-VERIFY driver-day (source AUTO = "Hệ thống tự gợi ý"):
  {"driver_id":3,"driver":"Nguyễn Duy Tuấn","work_date":"2026-11-18","symbol":"K","source":"AUTO","entered_by":15,"entered_at":"2026-11-22 23:43:10.128+00","month_status":"OPEN"}
KSEED-VERIFY bao-cao row 11/2026 (Tổng lệnh kẹp ≥ 1, CHUYẾN 2→1):
  {"driver_id":3,"driver":"Nguyễn Duy Tuấn","tong_lenh_don":"0","tong_lenh_kep":"1","so_chuyen_quay_dau":"0","tong_so_chuyen":"1"}
KSEED-VERIFY audit (system auto-write):
  {"user_id":15,"message":"Tự ghi ký hiệu chấm công K ngày 2026-11-18","entity_type":"TIMESHEET_MONTH","entity_id":13}
  {"user_id":15,"message":"Tự ghi ký hiệu chấm công K ngày 2026-11-18","entity_type":"TIMESHEET_MONTH","entity_id":13}
```

## Verify queries (psql qua container, không mở port)

`ssh root@vantai.tingting.vip 'docker exec -i vantai-postgres-1 psql -U vantai -d vantai'`:

```sql
SELECT d.id AS driver_id, d.name AS driver, dd.work_date, dd.symbol, dd.source, dd.entered_by, dd.entered_at, m.status AS month_status FROM driver_timesheet_days dd JOIN drivers d ON d.id = dd.driver_id JOIN driver_timesheet_months m ON m.id = dd.month_id WHERE dd.work_date = '2026-11-18' AND dd.symbol = 'K';
SELECT count(*) AS nov2026_k_cells FROM driver_timesheet_days dd JOIN driver_timesheet_months m ON m.id = dd.month_id WHERE m.year = 2026 AND m.month = 11 AND dd.symbol = 'K';
SELECT t.id, t.trip_code, t.driver_id, d.name AS driver, t.truck_id, t.status, t.completed_at, (t.completed_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS business_date, tc.container_number, tp.pair_kind, tp.status AS pair_status FROM trips t JOIN drivers d ON d.id = t.driver_id LEFT JOIN trip_containers tc ON tc.trip_id = t.id LEFT JOIN trip_pairs tp ON tp.id = t.active_trip_pair_id WHERE t.trip_code LIKE 'QA-SIL894-K%' ORDER BY t.id;
SELECT sf.id AS fulfillment_id, sf.fulfillment_type, sf.cargo_mode, sf.dispatch_classification, sf.shipment_id, s.shipment_code, s.customer_id, c.name AS customer, c.code AS customer_code FROM shipment_fulfillments sf JOIN shipments s ON s.id = sf.shipment_id JOIN customers c ON c.id = s.customer_id WHERE s.shipment_code = 'QA-SIL894-K' ORDER BY sf.id;
SELECT d.id AS driver_id, d.name AS driver, count(*) FILTER (WHERE dd.symbol = 'Đ') AS tong_lenh_don, count(*) FILTER (WHERE dd.symbol = 'K') AS tong_lenh_kep, count(*) FILTER (WHERE dd.symbol = 'Q') * 2 AS so_chuyen_quay_dau, count(*) FILTER (WHERE dd.symbol = 'Đ') + count(*) FILTER (WHERE dd.symbol = 'K') + count(*) FILTER (WHERE dd.symbol = 'Q') * 2 AS tong_so_chuyen FROM driver_timesheet_days dd JOIN drivers d ON d.id = dd.driver_id JOIN driver_timesheet_months m ON m.id = dd.month_id WHERE m.year = 2026 AND m.month = 11 AND d.id = 3 GROUP BY d.id, d.name;
SELECT user_id, message, entity_type, entity_id FROM audit_logs WHERE message = 'Tự ghi ký hiệu chấm công K ngày 2026-11-18' ORDER BY id;
```

Output verbatim:

```text
 driver_id |     driver      | work_date  | symbol | source | entered_by |         entered_at         | month_status
-----------+-----------------+------------+--------+--------+------------+----------------------------+--------------
         3 | Nguyễn Duy Tuấn | 2026-11-18 | K      | AUTO   |         15 | 2026-11-22 23:43:10.128+00 | OPEN
(1 row)

 nov2026_k_cells
-----------------
               1
(1 row)

 id  |  trip_code   | driver_id |     driver      | truck_id |  status   |    completed_at     | business_date | container_number | pair_kind | pair_status
-----+--------------+-----------+-----------------+----------+-----------+---------------------+---------------+------------------+-----------+-------------
 551 | QA-SIL894-K1 |         3 | Nguyễn Duy Tuấn |        1 | COMPLETED | 2026-11-18 02:30:00 | 2026-11-18    | QATU8940040      | KET_HOP   | ACTIVE
 552 | QA-SIL894-K2 |         3 | Nguyễn Duy Tuấn |        1 | COMPLETED | 2026-11-18 08:30:00 | 2026-11-18    | QATU8940040      | KET_HOP   | ACTIVE
(2 rows)

 fulfillment_id | fulfillment_type | cargo_mode | dispatch_classification | shipment_id | shipment_code | customer_id |   customer    | customer_code
----------------+------------------+------------+-------------------------+-------------+---------------+-------------+---------------+---------------
           1098 | FCL_CONTAINER    | FCL        | COMBINED                |        1158 | QA-SIL894-K   |          42 | QA KH SIL-894 | QASIL894KH
           1099 | FCL_CONTAINER    | FCL        | COMBINED                |        1158 | QA-SIL894-K   |          42 | QA KH SIL-894 | QASIL894KH
(2 rows)

 driver_id |     driver      | tong_lenh_don | tong_lenh_kep | so_chuyen_quay_dau | tong_so_chuyen
-----------+-----------------+---------------+---------------+--------------------+----------------
         3 | Nguyễn Duy Tuấn |             0 |             1 |                  0 |              1
(1 row)

 user_id |                  message                   |   entity_type   | entity_id
---------+--------------------------------------------+-----------------+-----------
      15 | Tự ghi ký hiệu chấm công K ngày 2026-11-18 | TIMESHEET_MONTH |        13
      15 | Tự ghi ký hiệu chấm công K ngày 2026-11-18 | TIMESHEET_MONTH |        13
(2 rows)
```

## Verify API (đúng response /timesheet/bao-cao đọc)

`POST /api/auth/login {identifier: phuongnt, password: Abc123}` →
`GET /api/timesheet/months?year=2026&month=11` (token Bearer). Verbatim:

```text
LOGIN ok user= phuongnt role= ADMIN
MONTHS returned: 10
DRIVER-DAY (API): {"driverId": 3, "driverName": "Nguyễn Duy Tuấn", "monthStatus": "OPEN", "id": 15, "workDate": "2026-11-18", "symbol": "K", "trips": 1, "isSunday": false, "tripAdjustment": 0, "note": null, "source": "AUTO", "enteredBy": 15, "enteredAt": "2026-11-22T23:43:10.128Z", "adjustedBy": null, "adjustedAt": null}
SOURCE->label: AUTO => 'Hệ thống tự gợi ý' (TimesheetMonthlyReportPage.tsx / TimesheetGrid.tsx)
BAO-CAO row (API-computed): {"driverId": 3, "Tong lenh don": 0, "Tong lenh kep": 1, "So chuyen quay dau": 0, "Tong so chuyen": 1}
NOV-2026 K cells anywhere in grid (API): 1
```

Mapping gốc của "origin": `TimesheetGrid.tsx` / `TimesheetMonthlyReportPage.tsx`
(`day.source === 'AUTO' ? 'Hệ thống tự gợi ý' : 'Điều vận đã chỉnh tay'`) —
`source: "AUTO"` trong payload chính là "Hệ thống tự gợi ý". `trips: 1` trên ô
K là phép đếm CHUYẾN 2→1 của bao-cao.

## Điểm K của QA — checklist

- ≥1 ô K trong grid 11/2026: `nov2026_k_cells = 1` ✓
- Ô K gợi ý bởi hệ thống (không phải manual): `source = AUTO`, audit
  "Tự ghi ký hiệu chấm công K ngày 2026-11-18" ✓
- TỔNG LỆNH KẾP ≥1: bao-cao row `Tong lenh kep = 1` ✓
- CHUYẾN 2→1: 2 trips COMPLETED (551, 552) → ô K `trips: 1`,
  `Tong so chuyen = 1` ✓

## Lifecycle / ghi chú

- **Idempotent**: guard bằng trip_code `QA-SIL894-K1/K2` — chạy lại không tạo
  thêm row, chỉ chạy lại sync (repair ô AUTO mất). Đã test cả 2 đường
  (local + staging re-run → `KSEED-SKIP`).
- **Fixture lifecycle**: rows mang dấu QA — `make qapurge` / `make demo` dọn
  theo `qa-fixture-registry`. Sau khi dọn, chạy lại invocation trên để QA có
  lại ô K (script nằm trong image từ lần `make demo` có chứa commit này).
- **Interlock**: `KSEED_ENV=local|staging` + từ chối DATABASE_URL prod
  (silversea.tingting) — cùng luật seed-qa-fixtures/purge-qa-fixtures.
- **Topology**: stack staging `vantai` (vantai-postgres-1, /opt/vantai) nằm trên
  droplet `vantai.tingting.vip` (hostname `demo`), KHÔNG phải droplet
  `silversea.tingting.vip` (chỉ có stack prod `silversea-*` — không đụng).
  Chạy qua đúng compose file `deploy/docker-compose.prod.yml` của Makefile.
- Script build ra dist bằng đúng pipeline của image (`tsc + fix-esm-imports`);
  evidence trên chụp với code của commit này (sau run chỉ sửa 1 comment usage).
