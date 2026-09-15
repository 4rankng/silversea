# Dispatcher task and note retest — 15 September 2026

Base: `9b99b1aa568e9e06c899a6ca86f2915e41bc23fe`. Scope: DISPATCHER (`dieuvan`) planning, assignment, lookup and related Kanban requirements. Driver UI belongs to the driver lane. Completion labels in Kanban are not verification evidence.

## Acceptance and regression cases

| ID | Reproduction | Expected result |
|---|---|---|
| DSP-6377 | Detailed plan row contains selected tasks and a free note with two or more lines; inspect collapsed note and open its full view. | Tasks occupy a distinct labelled block before the free note; free-note line breaks remain visible. Customer note remains separate. No concatenated task/note sentence. |
| DSP-NOTE-01 | Open assignment note editor; select multiple tags; type a sentence character by character, including spaces and Enter; blur, save, reopen. | No lost spaces, no bare-Enter submit, tags and free-text remain separate, stored newline contract is preserved. |
| DSP-NOTE-02 | Load legacy semicolon-only task notes, plain multiline text, unknown/renamed task labels, and blank notes. | Known tasks are distinguished without dropping unknown text; blank sections create no wasted space. Full note stays reachable. |
| DSP-NOTE-03 | Change a selected task or rename a task while a multiline manual draft exists. | The manual draft survives unchanged; only the selected task identity changes. |
| DSP-PORT-01 | Create/export row with pickup port A and dropoff port B; inspect both planning grids and CUS labels. Repeat import and unknown direction. | Cảng nâng remains A and Cảng hạ remains B; direction never swaps already canonical pickup/dropoff fields. Missing values are explicit and short labels keep full detail. |
| DSP-PAGE-01 | Mix fulfillment rows and fulfillment-less READY container rows with page size 2; iterate every page across different cargo priorities and dates. | Every matching row appears exactly once in canonical global priority order; items, total, final page and assignment filters agree. No branch rows lost at page boundaries. |
| DSP-PLAN-01 | Review current general/detail plan tests and source against relevant Kanban: all-container/LCL rows, carrier assignment, reassignment, appointment precision, lift/drop fields, row keys, density and modal exit. | Each ticket mapped individually to current evidence or an explicit gap; prior QA labels do not count as a pass. |
| DSP-UI-01 | Parent drives Chrome as dispatcher on phone 390px, tablet 834px and desktop 1440px. | Task/note hierarchy is legible, no clipping or horizontal body overflow, actions remain compact and usable. Source/unit coverage is not substituted for this browser rung. |

## Touchpoints and verification

- Frontend: detailed-plan note rendering/editor and focused regression tests; reuse the shared `parseDriverTaskNote` storage contract.
- Backend/schema changes only if tracing proves persisted note corruption. Coordinate driver/shared ownership first.
- Run scoped frontend tests and typecheck; save complete command output under ignored `qa/2026-09-15_cus-dispatch-driver-retest/`.
- Root owns serialized Chrome and final combined gates. No commits, index writes, deployment or production mutation.
- Final mapping and limitations: `qa/2026-09-15_cus-dispatch-driver-retest/dispatch.md`.

Final gate follow-up: external-only allocation must await carrier catalog readiness before clicking the enabled add-carrier action; verify the default empty own-fleet row is omitted from saved allocations.

User follow-up: narrow shared combobox fields hide only their decorative default search icon based on control width, recover icon/gap/left-padding space, preserve custom semantic icons, labels, selection and clear action, and retain the search icon on wide fields. Parent verifies actual narrow/wide controls in Chrome.

DSP-COPY-01 (observed Chrome follow-up, before label change): CUS overview still labels a financial-reconciliation metric `Chờ Kế toán` and shows a container-save banner about `Xác nhận Kế toán cũ`. After saving a valid container edit, use `Chờ đối soát` and a concise banner explaining that accounting reconciles the latest data before lot locking. Keep the API-backed metric count, source/version/checksum conditions, role permissions and lock behavior unchanged. Re-run the existing overview priority and successful container-save cases with the updated rendered-copy assertions; parent owns final Chrome observation.
