# FIX CHI PHÍ lần 2 — 6 mục spec 19/10 + 3 mục §c (PRD) — 2026-10-21

Controller: agent, worktree `1njkloyy/fix-accounting-fix2`, branch
`fix-accounting-fix2` (off main `56a5d509`). Spec `19.10 - FIX CHI PHÍ.docx`;
bố cục mockup đọc từ `docs/prd/PhanHeKeToan.md` (session không vision — ghi
rõ trong qa README). Stack riêng FE `:7185` / BE `:3012` (lane khác giữ
7175/3002); DB chung `ss-prod-db:5441`. Staging KHÔNG đụng.

**Status**: verify-first 9 mục → 6 mục ĐÃ ĐÚNG (1,3,4*,5,6,7,8,9 — *item 4
thêm "-- Ngày … – …" vào heading) → item 2 LÀ PHẦN FIX: sweep `grouped`
(+`signed` nơi FB-100) 23 ô tiền trên ~20 file + `tabular-nums` trên shared
money primitives (`.money`/`.num`/`.record-table .num`/`.ds-field--money
input`) + nới `font-family-contract.test` (font Be Vietnam Pro chưa có tnum —
đo bằng fontTools, ghi qa README; declaration inert tới khi đổi typeface).
Evidence + coverage bảng §9: `qa/2026-10-21-accounting-fix2/` (drivers
`qa/scripts/2026-10-21-accounting-fix2-*.mjs`). Item 6 Xuất debit: UI DRIVEN
PASS (banner + downloadWillBegin + xlsx 9922B PK + `billing_documents#16191`)
— bug "không xuất được" gốc (idempotency-key >100 ký tự) đã land từ trước.
Item 7 khớp số tuyệt đối 2/2 thời điểm (127.000.000 / 126.850.000). §c ghi
nhận: cơ chế duyệt là NÚT (không phải cột tick Ngày duyệt như PRD mô tả) —
không đổi bề mặt owner-landed; số âm hiện có dấu đỏ + nhãn theo ruling
141026230770.

- **Gates**: lint 0 (r1+r2) · FE tsc 0 · FE suite (xem qa log cuối) · make
  build ✓ (r1+r2) · BE không đụng (không BE gate). Regression pins:
  `money-format-sweep.chiphi2` CP2-M1..M6, report-section heading,
  font-contract. **Review độc lập R1** (code-reviewer): REQUEST_CHANGES →
  fix hết — 2 ô per-liter decimal revert raw (giá dầu gốc, ngưỡng VNĐ/lít),
  refund field bỏ className double-chrome (F2 verify UI
  `02-f2-refund-field-1440.png`), treasury +signed, nits.
- **Nợ/lưu ý**: (1) các ô đơn giá VND/lít step 0.01 (payables-fuel-invoices)
  GIỮ NGUYÊN — grouped bỏ decimal, đổi sẽ sai số; (2) 2 input disabled
  BillingDocumentBuilder đổi sang hiển thị formatCurrency; (3) QA note
  `2026-10-21-lcl01-lan2-repro.mjs` đổi ví dụ cổng 3016→3002 cho qua dev-port
  contract (file của lane khác, chỉ sửa comment).

---

# LCL-01 lan 2 — overview/detail không đồng bộ, shape container-row chưa có ngày (card 211026180528) — 2026-10-21

Controller: this agent, worktree `1njkloyy/fix-lcl01-lan2`, branch `fix-lcl01-lan2`
(off main `9aab78d2`). Commit `ddf45946`, pushed origin. Staging READ-ONLY suốt lane.

**Status**: DONE — verify-first trên build 9aab78d2 → root cause → fix → gates →
review độc lập (land as-is) → commit+push. Staging KHÔNG deploy (owner recut wave).

- **QA lot (diff probe)**: staging probe toàn bộ page, 6 account (5 CUS + admin),
  đúng 1 lô rớt: **133 / SHP-2610-00069** — QA Vũ Văn Tiệp tạo 17:09 (`POST
  /shipments` body `{customerId}` → cargo_mode NULL) + 2 cont 20' chưa hẹn ngày
  17:11 (fixture DRI-03; owner addendum xác nhận). Card wedge 18:05 = lô này.
- **Root cause**: `containerDayTriageCondition` (lan 1) chỉ miễn container-less
  LCL. Row CÓ container mà triage day `coalesce(appointment, EDD)` = NULL không
  match range nào → bị mọi date arm drop khi Tổng quan (không date scope mặc định)
  vẫn liệt kê.
- **Fix**: arm thứ ba `isNull(containerTransportDateSql())` — row không có triage
  day đi ngoài day-triage bất kể cargo shape; arm lan 1 + dateArms giữ nguyên.
  Nulls-first sort arm của board sống lại (unscheduled lên đầu).
- **Gates**: be-tsc 0 · scoped 35/35 · BE unit 347/347 · BE test 335/335 · lint 0 ·
  pin 6/6 (3 cũ + 3 mới). BEFORE repro failures=2 → AFTER 8/8 (qa/2026-10-21-lcl01-lan2/).
- **Nợ/lưu ý**: (1) commit message có lỗi gõ "зерка" (cosmetic, không amend theo
  luật append-only); (2) bất đối xứng cố ý còn lại: Tổng quan với filter ngày TỰ
  CHỌN vẫn ẩn lô undated — đã ghi case doc, ngoài scope; (3) staging re-verify sau
  deploy thuộc owner; UI click-through 390px chưa drive (evidence cấp API theo
  brief); (4) QA lot 133 để nguyên cho DRI-03 (KHÔNG dispatch).

---

# DIS-08 lan 2 — container identity weight law (card 211026180428) — 2026-10-21

Controller: agent, worktree `fix-dis08-lan2` (off main `9aab78d2`), branch
`fix-dis08-lan2`. Previous HANDOFF owners (FB-066 quickadd, R29F FB-093) đều
DONE — replaced per protocol.

**Status**: DONE — root-caused, fixed, verified UI DRIVEN 15/15 (390/768/1440),
gates green, review APPROVE. Commit trên branch; push theo brief.

## Root cause (verify-first, staging read-only + local)

QA wedge 18:04 là CỘT "Tổng quan hàng hóa" trên /dispatch: cùng dòng cont
"1 x 40HC" = **400** trong cột Hàng, nhưng 600 dưới Cảng nâng/Hạ (sibling
selector page-local card B 18/10). Không có law dùng chung — mỗi surface tự pin
(master port columns / detail cell 20261005_361 / cargo cell không pin gì).
Loại trừ: CSS token undefined (var chain + `--fw-semibold:600` trên :root OK),
font mapping (SemiBold 600 face thật, widths 400/500/600/700 khác nhau).

## Fix

Shared owner `frontend/src/styles/operational-table-typography.css`:
`.ops-container-line, .ops-table .ops-container-line { font-weight:
var(--ops-table-primary-weight) }`. Compound selector là bắt buộc — selector
đơn thua `.master-plan-grid__location-value{400}` cùng specificity theo source
order (regression bị local driver bắt sống: port summaries rơi 400 round đầu).
Áp: cargo count lines (flag `identity`, placeholder "Chưa có cont" giữ thường),
port summaries (xóa sibling selector), detail serial (xóa page-local weight,
giữ size/nowrap). Port name 400 mọi chỗ. Non-goals: drawer (đã ≥600), presence
chips, XLSX export (text-only).

## Evidence

`qa/2026-10-21-dis08-lan2/` (force-tracked): staging probes (wedge + font),
local driver before(FAIL 400)/after(15/15 PASS) ×3 widths, screenshots, gates
(tsgo/tsc/lint/scoped/FULL FE/make build). Review: APPROVE (Low finding về `''`
predicate ĐÃ áp dụng + test cover). Flake note: `RoleWorkInbox` UI43 fail 1 lần
dưới full-suite load, PASS isolated 22/22 và PASS run1 — không phải regression
của lane này.

## Next

- Merge trunk + staging recut khi wave đóng (src change có runtime FE).
- Regression case: `testplan/2026-10-21-dis08-lan2-cards.md` (DIS08-L2-01..05).
