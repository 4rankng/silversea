# Verify-fail re-verification on the CURRENT build — tickets 201026090100 / 201026090200 / 201026092400 (20/10/2026)

Source: QA verify round ran against a STALE staging window (backend pre-fix).
This round re-verifies all three cards by browser on the live staging build
with a HARD build-currency gate (`/api/health.buildHash`), the same discipline
that resolved the FB-111 / card 201026090100-adjacent false alarm (probe
d3dab437, lot 161580 INHERIT_PASS at HEAD).

**Build note:** staging ran `c7d305ce` at round start and a newer main deploy
landed mid-round (`57d253ff`, card 201026095604a — tổng hợp công nợ short
names). Both builds contain all three fixes under test (`fd5fbdd9`,
`65acec44`, `2e1a762b` are ancestors of `57d253ff`); the final evidence for
every card below is from build **`57d253ff`**. Mid-run gate file:
`qa/2026-10-20-verifyfail/201026090100_build-gate.json`.

Drivers (staging, headless Chromium, token injection, `qa/2026-10-20-verifyfail/`):

- `testplan/qa/scripts/2026-10-20-verifyfail-debit-board.mjs`
- `testplan/qa/scripts/2026-10-20-verifyfail-add-container.mjs`
- `testplan/qa/scripts/2026-10-20-verifyfail-fb002-enter.mjs`

## Verdict 1 — TC-201026090100 (A.1 thêm container auto-copy): **PASS — stale-staging false alarm, fix fd5fbdd9 live**

- **Drive (CUS, lot 174 `DNKM13335`, FCL, đang chạy):** drawer → container
  ledger → Thêm container → draft seed copied Trọng lượng `20500` from the
  sibling row (card 191026100000 law live); entered ONLY `CSQU3054383` → row
  rendered with Tuyến `ASKEY`, Nâng `Cảng Đình Vũ`, Hạ `TC - HICT`, trọng
  lượng `20.500`; toast "Đã thêm container CSQU3054383."
- **DB/API proof:** read-back of the new line carried `routeName=ASKEY` +
  `rawRouteId=13`, `liftSite`/`dropoffSite` populated. Nhà xe stayed
  "Chờ phân xe" because the sibling itself has no carrier — first-non-null
  inherit law, not a copy failure.
- **Cleanup:** probe row removed via the cus-workspace remove route → lot back
  to 1 container (HTTP 200).
- **Evidence:** `201026090100_ui-01-addform-seed.png`,
  `201026090100_ui-02-addform-filled.png`, `201026090100_ui-03-newrow-inherit.png`,
  `201026090100_ui-driver.log` (RUNG3_DRIVE_PASS).
- Note: lot 161580 (d3dab437's local pin) 404s on staging — that probe was a
  local HEAD pin; staging discovery picked lot 174 instead (guard statuses:
  only COMPLETED/CANCELED refuse container edits).

## Verdict 2 — TC-201026090200 (chốt-debit tên ngắn): **PASS — fix 65acec44 live**

- **Drive (Kế toán `hoapt`):** `/accounting/chot-debit` renders 81 lot cells /
  35 Phân xe cells; Thông tin lô hàng shows `LONG MINH` (never "CÔNG TY TNHH
  MTV LONG MINH"); Phân xe shows `BIỂN XANH` and plates — zero
  `CÔNG TY`-prefixed legal names on the board.
- **Wire proof:** `/accounting/debit-board` (191 rows) carries LONG MINH rows
  as exactly `LONG MINH`; no customer name on the wire starts with "CÔNG TY".
  Abbreviated names ("TNHH SX TM Dệt May Vân Trung", "CP Vận tải Biển Bạc")
  ARE short names, not leaks.
- **Evidence:** `201026090200_ui-01-debit-board.png`,
  `201026090200_ui-02-customer-shortname.png`,
  `201026090200_ui-03-phanxe-shortname.png`, `201026090200_ui-driver.log`
  (RUNG3_DRIVE_PASS). Read-only — no data mutated.

## Verdict 3 — TC-201026092400 (FB-002 Enter không lưu lịch trình): **PASS — no regression, fix 2e1a762b live**

- **Surface nuance:** the "Chỉnh sửa Lịch trình" quick-edit dialog exists on
  **LCL** rows only (FCL schedule cell is readonly by design —
  `CusShipmentRow.tsx`; see `201026092400_debug-fcl-readonly-surface.png`).
  Staging fixture: LCL lot 143 `BL-SEAM2-B-1789702634486`, NEW bucket.
- **Drive:** click `#cus-inline-schedule-143` → dialog → CLICK the Giờ field
  (picker opens) → hand-type `1630` over the empty field → value "16:30",
  focus auto-advanced to the date `dd` segment (FB-030 hand-off) → Enter.
- **Result:** PUT `/shipments/143` fired (`{expectedVersion, expectedDeliveryDate:
  "2026-10-06", plannedReturnAt: "2026-10-06T16:30:00+07:00"}`), dialog
  closed, toast "Đã cập nhật lịch đóng/trả." — the Enter reached the save
  path instead of being swallowed by the picker. Wire read-back:
  `plannedReturnAt=2026-10-06T09:30:00.000Z` (= 16:30 +07); closingAt and
  transportDate untouched.
- **Restore:** original schedule put back (PUT 200; closingAt
  `2026-10-04T02:00:00.000Z`, plannedReturnAt null, version advanced 1→3→5).
- **Evidence:** `201026092400_ui-01-dialog-open.png`,
  `201026092400_ui-02-after-typing.png`, `201026092400_ui-03-after-enter.png`,
  `201026092400_ui-driver.log`, `201026092400_db-side-effect.txt`
  (RUNG3_DRIVE_PASS).

## Coverage

| Claim / bug | Rung | Evidence | Not covered |
|---|---|---|---|
| 201026090100 A.1 auto-copy | UI DRIVEN | qa/2026-10-20-verifyfail/201026090100_ui-0{1,2,3}*.png + ui-driver.log + API read-back | COMPLETED/CANCELED lots (guarded by design); staff roles (CUS-only surface); mobile viewport |
| 201026090200 debit short names | UI DRIVEN | qa/2026-10-20-verifyfail/201026090200_ui-0{1,2,3}*.png + ui-driver.log + wire probe | Debit Note export file (out of scope by card); non-ACCOUNTANT roles |
| 201026092400 FB-002 Enter-save | UI DRIVEN | qa/2026-10-20-verifyfail/201026092400_ui-0{1,2,3}*.png + ui-driver.log + db-side-effect.txt | FCL schedule surface (readonly by design, not a regression); picker-finishing Enter (20260915_6/8 law, unchanged); invalid-draft Enter |

No code changes were needed — all three verify-fails were stale-staging
artifacts; the fixes (`fd5fbdd9`, `65acec44`, `2e1a762b`) are live on staging
build `57d253ff`.
