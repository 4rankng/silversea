# Case QA-2026-09-24-07 — Ops "Khai báo chi phí": Số Cont persistence + money-guard (audit c12 cluster A)

- **Case ID:** QA-2026-09-24-07
- **Reported:** 2026-09-24, from Director work order c12 addendum, cluster A
  (audit images `/tmp/opencode/c12/annotated/image1.png`, `image3`, `image4`, `image5`).
- **Surface:** `/ops/orders` ("Kế hoạch làm hàng") → row action "Khai chi phí" →
  "Khai báo chi phí" modal (`OpsExpenseFormModal` + `OpsExpenseFinancialFields`).
- **Status:** FIXED on this case — FE guards + regression fences landed in the same
  commit series as this file.

## Findings and verdicts

| Bug | Verdict | Evidence |
| --- | --- | --- |
| A1 Số Cont resets to placeholder "Select" after Loại phí / Nhóm chi phí change | NOT reproducible at prod `a26035d9` — component test driving the real modal through the exact audit interaction order (container → Loại phí → Nhóm chi phí) keeps the Số Cont selection at every step; no commit in the file's history ever reset `containerChoice`. The "Select" text is the vendored select's ENGLISH default placeholder, shown only when the control's value is a key matching no option — never by a code path reachable from this form at HEAD. Most likely evidence artifact: stale dev-server module (see plans/reports staging lesson) or an interaction only reachable with a real pointer. | `OpsExpenseFormModal.containers.test.tsx` case "A1: keeps the Số Cont selection…" (green at HEAD, kept as lock); zoomed screenshots: "Select" renders in muted placeholder styling |
| A1 styling — placeholder must be distinguishable from a real value | REAL GAP, FIXED — the plain-select branch of the sanctioned adapter never passed a placeholder, so an empty select rendered the English default "Select" instead of house Vietnamese copy. Now the fallback placeholder is `— Chọn —` (or the option labelled empty) and the muted `text-placeholder` token keeps it visually distinct from dark value text. | red-first case "A1: an empty plain select shows a Vietnamese placeholder…" (FAILED at HEAD, now green) |
| A2 "Giá trị phải lớn hơn 0" toast with Thực chi = 450.000 | REAL BUG (latent), FIXED — the toast is the API-error toast showing a 400 from `POST /ops/expenses`. The body carries zod's DEFAULT message of `shipmentContainerId: z.number().int().positive()` (backend/src/routes/ops.ts expenseCreateSchema), which `frontend/src/lib/api/errors.ts` translates to "Giá trị phải lớn hơn 0". The FE submit path could send `shipmentContainerId: 0` whenever the Số Cont control value was an empty string (`Number('') === 0`), and 0 fails `.positive()`. Thực chi 450.000 itself was always valid — the amount rule is "Số tiền phải là số dương" client-side and `parseOpsMoney` server-side. | toast zoom (`/tmp/opencode/c12/image4-toast5.png`); `frontend/src/lib/api/errors.ts:67`; `backend/src/routes/ops.ts` expenseCreateSchema; red-first case "A2: an empty Số Cont choice is shared-lot, not container 0" (compile-red at HEAD against the un-exported guard, now green) |
| A3 clicking a suggestion chip must set the Loại phí input | AUDIT MISREAD — no code change. Chips are "Gợi ý khoản chi" wired to **Tên khoản chi** (`feeName`), and image5 itself shows the clicked chip "Sửa tờ khai" DID fill Tên khoản chi. The audit's literal fix would write a fee-name string into the expense-TYPE field (catalog code), corrupting the payload. The Loại phí combobox keeping "Phí soi chiếu" while Nhóm chi phí is overridden to a no-invoice group is an allowed manual override (docs/prd/OpsVanHanh.md: "cờ đường phê duyệt — không phải khóa sửa trên màn hình nhập chi phí"). | case "A3: a suggestion chip fills Tên khoản chi and never rewrites Loại phí" (green — behavior locked) |
| A4 Nhóm-chi-phí dropdown options clipped without ellipsis | NOT REPRODUCIBLE at HEAD — zoom of image1 shows all five labels render complete ("Có hóa đơn · Nâng/Hạ/Phí khác", "Không hóa đơn · Giao nhận/Phát sinh"); the perceived truncation coincides with the docx red-annotation boxes crossing the text. House skin already wraps long options (whitespace-normal). Defensive CSS floor landed anyway per directive: `.ds-uui-select__popover { min-width: 220px; max-width: calc(100vw - 32px) }` — dropdown-only, no ellipsis (design law §4 bans ellipsis on values). | dropdown zoom; UuiSelectField.css lock |

## Regression fence

`frontend/src/features/ops/OpsExpenseFormModal.containers.test.tsx` — 5 cases:
1. A1 persistence lock (container → Loại phí → Nhóm chi phí; Số Cont never clears);
2. A2 shared-lot submit serializes `shipmentContainerId: null` with a real container catalog;
3. A2 `opsContainerId` guard unit (LOT/''/id);
4. A1 Vietnamese placeholder fence (plain select, never the English "Select");
5. A3 chip → Tên khoản chi, Loại phí untouched.

## Re-shot needs (QA lane)

- Browser re-shot of the modal after picking Loại phí (expect Số Cont unchanged) — needed to
  replace the stale evidence for A1/A2; agent browser was serialized on the QA lane this wave.
- Re-run P1 step 4 (image4 flow) end-to-end: with the FE guard, a no-container submit can no
  longer produce the red "Giá trị phải lớn hơn 0" toast from the container field.
