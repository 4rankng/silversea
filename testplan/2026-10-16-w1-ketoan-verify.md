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
