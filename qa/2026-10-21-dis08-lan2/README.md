# DIS-08 lan 2 — container identity weight law (card 211026180428)

Lane: `fix-dis08-lan2` (off main `9aab78d2`). QA round 18:04 verdict
"container KHÔNG in đậm" trên build 9aab78d2 — verify-fail lần 2 sau fix lần 1
(3349fd52, claim "container 600 / port 400 compliant at HEAD").

## Verify-first (staging, READ-ONLY — không ghi/đồng bộ staging)

Probes login `dungnv` (read-only), mở 2 bảng, đo computed font-weight:

| Probe | Kết quả |
|---|---|
| `staging-probe.json` / `staging-probe2.json` | /dispatch: port 400, summary 600; /dispatch-detail: serial 600, port 400 — tại 390/768/1440; drawer serial ≥600 |
| `staging-font-probe.json` + `staging-font-requests.json` | Be Vietnam Pro 600 face THẬT (width 400/500/600/700 khác nhau; SemiBold.ttf 200) — loại giả thuyết font-mapping |
| **`staging-wedge-cargo-column.json`** | **WEDGE: cột "Tổng quan hàng hóa" /dispatch — dòng cont "1 x 40HC" = 400, trong khi cùng dòng dưới Cảng nâng/Hạ = 600 (cùng màn hình, cùng dữ liệu)** |

→ QA thấy "không in đậm" ở dòng cont cột Hàng. Fix lần 1 verify port columns +
detail grid nhưng không bao giờ đo cột Hàng.

Screenshots: `staging-dispatch-before.png`, `staging-dispatch-detail-before.png`,
`staging-dispatch-row-cargo-column.png`, `staging-dispatch-drawer.png`.

## Root cause

Không có law dùng chung cho weight "dòng container". Mỗi surface tự pin:

- master port columns: adjacent-sibling selector page-local (card B 18/10)
- detail container cell: page-local rule (card 20261005_361)
- master cargo cell: **không pin gì** → base 400 (wedge)

Surface nào bỏ lọt thì silently thường — defect class, không phải 1 ô sót.

## Fix (shared owner, 1 law)

`frontend/src/styles/operational-table-typography.css` — class dùng chung
`.ops-container-line` (+ compound `.ops-table .ops-container-line` để thắng
cascade same-specificity của rule port-name 400, bất kể thứ tự stylesheet):

```css
.ops-container-line,
.ops-table .ops-container-line { font-weight: var(--ops-table-primary-weight); }
```

Áp: cargo cell count lines (`identity` flag — placeholder "Chưa có cont" giữ
thường), port-column summary lines (xóa sibling selector), detail container
serial (xóa page-local weight, giữ size/nowrap). Port name giữ 400 mọi chỗ.

Bài học cascade: selector đơn (0,1,0) thua rule page cùng specificity theo source
order — regression này bị local driver bắt sống ở round sau (02a fail 400) trước
khi có compound selector.

## Local verify (driver mjs, BEFORE/AFTER, 390/768/1440)

`node testplan/qa/scripts/2026-10-21-dis08-lan2-local-driver.mjs before|after`
(logs: `local-driver-before.log.json` / `local-driver-after.log.json`,
screenshots `local-dispatch[-detail]-{before,after}-{390,768,1440}.png`):

| Case | before | after |
|---|---|---|
| DIS08-L2-01 cargo count ≥600 (3 widths) | **FAIL 400** | **PASS 600** |
| DIS08-L2-02a port summary ≥600 | PASS 600 | PASS 600 |
| DIS08-L2-02b port name ≤400 | PASS | PASS |
| DIS08-L2-03a detail serial ≥600 | PASS | PASS |
| DIS08-L2-03b detail port ≤400 | PASS | PASS |

AFTER = 15/15 PASS. API data identity (read-only rows) trong driver log
(`api-identity`) — styling pass không đụng dữ liệu.

## Gates (verbatim trong `gates-*.txt`)

| Gate | Kết quả |
|---|---|
| FE `npx tsgo --noEmit` | 0 errors (re-run sau review fixes: 0) |
| FE `npx tsc -b` | 0 errors (re-run sau review fixes: 0) |
| Root `pnpm lint` | 0 errors |
| Scoped vitest (8 files) | 46 pass; post-review scoped 5/5 + MasterPlanGrid.test 47/47 |
| **FULL FE `pnpm test`** | run1 5418/5420 (2 fail = dist-chưa-build), build xong → run2 5419/5420 (1 fail `RoleWorkInbox` UI43 — **flake**, file đó PASS run1 + isolated 22/22), **run3 (sau review fixes): 703 files / 5420 tests PASS, exit 0** |
| `make build` | exit 0 (11.17s); law sống sót minification (`index-*.css` + `operational-table-typography-*.css` đều chứa compound rule) |

## Review độc lập

code-reviewer subagent (session ses_ea1f74c42ffeWRabl1Hk9Bl1Wc): **APPROVE**.
Verified: cascade reasoning (compound 0,2,0 thắng mọi page rule bất kể thứ tự),
sweep toàn bộ font-weight rules 2 grid (không rule nào ≥(0,2,0) chạm dòng cont),
không surface cont nào còn dưới law, export consumers an toàn, 624/624 dispatch
tests. 1 Low finding (`identity` predicate `!= null` vs `!summary` cho `''`)
— **đã áp dụng**: `!!containerSummarySource` + test placeholder cover `''`.
2 informational (comment wording — đã reword; static-pin không giữ được
cascade — inherent, live probes phủ).

## Coverage table (§9)

| Claim / bug | Rung | Evidence | Not covered |
|---|---|---|---|
| Cargo-column container count không đậm (wedge QA) | UI DRIVEN | local-driver-before/after logs + PNG 3 widths; staging-wedge-cargo-column.json | staging CHƯA có fix (deploy chờ wave); role CUS không vào được trang này; dark mode không có trong app |
| Port summary lines giữ 600 sau khi đổi sang shared class | UI DRIVEN | local-driver-after (02a PASS ×3) + container-identity.test.tsx | English locale (không có); staging post-deploy |
| Detail serial 600 / port 400 không hồi quy | UI DRIVEN | local-driver-after (03a/03b PASS ×3) + container-port-weight.test.tsx | editor dialog identity (aria-label only); kẹp-pair tag span (cùng dòng, thừa kế weight) |
| Shared class thắng cascade page rule 400 | UI DRIVEN | regression bắt sống ở after-run đầu (02a FAIL 400) → compound selector → PASS | các grid ngoài ops-table scope (chưa có consumer) |
