# W1 ketoan + chấm công — closed-loop staging QA (FB-096…FB-104)

- Run: 2026-10-16, staging `https://vantai.tingting.vip`, health `buildHash 7dcdcf33`
  (= W1 merge commit — build matches the wave, no stale-build caveat).
- Roles: ACCOUNTANT `hoapt` (original FB-100 reporter), ADMIN `admin`,
  DISPATCHER `dungnv`, OPS `hoangnh` (testplan/testaccounts.txt; passwords never
  echoed into artifacts). Demo `ketoan` does NOT exist on staging — ACCOUNTANT
  named accounts used instead.
- Method: puppeteer headless, token injection before SPA navigation, real
  clicks/typing; every write carries `Idempotency-Key`; fixtures prefixed
  `QA-W1-` and namespaced for the sanctioned qa-fixture purge
  (backend/src/seed/qa-fixture-registry.ts).
- Evidence: `testplan/qa/2026-10-16_w1-verify/` — per card: screenshots
  `<card>_NN-*.png`, DOM assertions `<card>_assertions.json`, driver log
  `<card>_ui-driver.log`, script `<card>-*.mjs`.
- FB numbering follows the testplan contracts + W1 commits (48ed1fe1…1623de28):
  FB-096 = Thêm cược (card …230730), FB-097 = Thêm khoản chi drawer (…230740),
  FB-098 = Khai chi phí on lot detail (…230750), FB-099 = chốt debit zones
  (…230760), FB-100 = tạm ứng/hoàn ứng approvals (…230770), FB-101…104 =
  chấm công (…230780…230810). The dispatcher's wave summary mislabeled
  FB-096/097 as advance/reimbursement — the advance/reimbursement surface is
  FB-100.

## FB-096 — Thêm cược: gợi ý bill 4 số cuối + tích hợp CUS — PASS (rung 3)

- UI: nav /accounting/deposit-tracker as `hoapt` → nút **"Thêm cược"** hiện
  (nhãn cũ "Thêm dòng" không còn); modal tiêu đề **"Thêm cược"**.
- Lookup `6159` (Bill BLCUS6159) → suggestion dòng
  `BLCUS6159 / Hãng tàu Accessibility / CÔNG TY TNHH MTV LONG MINH` → click →
  tự điền Số Bill + Khách hàng + Hãng tàu (CUS data: Bill/Booking – Hãng Tàu –
  Tên khách).
- Đổi Số Bill thành `QA-W1-DEP-6159` + Ghi chú fixture → **"Lưu dòng"** →
  dialog đóng, dòng hiện trên bảng.
- Persisted: `GET /api/accounting/deposits` trả về row **id 7**
  (`QA-W1-DEP-6159`). POST dùng Idempotency-Key (driver log).
- Evidence: fb096_01…04 png, fb096_assertions.json (10/10 checks true),
  fb096_ui-driver.log, fb096-deposit-tracker.mjs.

## Phase note (Muse QA lane, 2026-10-16 16:36–17:00+08) — lane collision + build re-cut

The 8 W1 cards (FB-097…104) were verified green by a parallel fleet lane and
merged to origin/main while this lane was mid-drive: merge `33cba980`
("W1 ketoan staging QA — fb096..104 verify green, 8 PASS"), with the
sanctioned-purge registry for the W1 fixture classes in `2e6acf92`; their
evidence lives in `testplan/qa/2026-10-16_w1-verify/`. Staging was re-cut
`5a139108 → 9e400e63` mid-run (owner pin 16:48+08: fleet merge of W1 QA
records + W4b, no changes to the W1/FB-009 surfaces under test; prior drive
results remain valid). This lane aborted its W1 drives per the build-gate law
at the first pin change and claims **no verdict on FB-097…104** — the landed
`33cba980` verdicts stand. Abort record: `fb097-khoan-chi-drawer.mjs` in
`testplan/qa/2026-10-16_w1-deep-verify/` (drive got as far as supplier-pick +
manual-pick hint before the pin moved; no row was ever saved — trip 4
Tiền đường count stayed 0 across all attempts). `ra.mjs` there carries the
React-Aria field-driving helpers this app's `UuiSelectField` surface needs
(no native selects; plain RAC Selects expose no visible `<label>` element —
address fields by option signature).

## FB-009 re-drive (card 131026233500) — copy giờ hẹn: PASS (rung 3)

- Build: staging health `buildHash 9e400e63` re-asserted immediately before
  the drive (owner pin; contains fix `a56c6882`). Role CUS `cus` (staging
  sanctioned exception), `/shipments/new`, headless puppeteer + token
  injection. Read-only phase: the create form was never saved — clipboard +
  toast evidence only, no persisted mutation.
- S1 — group "Ngày giờ đóng trả cho tất cả cont": nút copy
  (`.csc-bulk-appointment__copy`, aria "Copy giờ hẹn đóng trả") **vắng mặt**
  khi ô trống; **xuất hiện** khi giá trị parse được; luôn hiển thị khi có mặt
  (opacity 1, visible, hit-test tại tâm mà không cần hover — đúng hợp đồng
  "always visible, no hover-reveal"). Click → OS clipboard đọc lại đúng
  `09:00 20/10/2026` + toast `Đã copy giờ hẹn 09:00 20/10/2026`.
- S2 — dialog "Chọn ngày giờ" (từ ô giờ hẹn của dòng cont): nút copy
  (`.combined-datetime__copy`, aria "Copy giờ hẹn trong hộp thoại") nằm cạnh
  nút "Đóng lịch" trong header; **vắng mặt** khi draft trống, **xuất hiện**
  khi date+time parse được. Click → clipboard `10:30 21/10/2026` + toast
  `Đã copy giờ hẹn 10:30 21/10/2026`.
- Regression context (surface của card 101026163010): nút copy-down từng
  dòng vẫn đúng luật gating — ẩn khi không còn dòng cont trống; sau khi thêm
  1 dòng trống, click copy xuống → dòng trống nhận `10:30 21/10/2026`
  (lưu ý: "Thêm container" nhân bản giá trị dòng cuối, nên driver phải xóa
  lịch của dòng mới trước).
- Evidence: `testplan/qa/2026-10-16_w1-deep-verify/fb009_01…06*.png`,
  `fb009_assertions.json` (12/12 checks true),
  `fb009_ui-driver.log`, `fb009-copy-time-staging.mjs`.
- Not covered: paste-side behavior trong app khác (clipboard được đọc lại
  in-driver với quyền granted); các surface giờ hẹn ngoài phạm vi card
  (CUS dashboard list, container ledger, dispatch) — unchanged per case doc
  "Still open".
