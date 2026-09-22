# Cost document QA — 22 September 2026

Source: user-supplied `các chi phí.docx`, 12 rendered pages, including seven
embedded examples and two comments. The document says the images come from the
old application and asks reviewers to focus on costs. Treat those layouts as
examples, not a requirement to recreate the old screens. Its comment defines
“thực thu” as the amount actually receivable from the customer.

Use synthetic local records and the existing permission, approval, audit and
financial-state contracts. A request to remove an input row must not silently
erase an approved payment or issued document. Record unsupported cases and
ambiguous draft sections explicitly rather than inventing accounting policy.

User clarification: “PHẦN NÀY CHƯA HOÀN THIỆN, ĐỂ LẠI” means **do not
work on that unfinished section**. New draft monthly-report/debit-issue
features in DOC-005–007 are excluded. Existing production behavior and its
demonstrated regressions remain in the QA scope.

The customer screenshot supplied during QA explains that container deposits
secure imported containers against damage. CUS marks **Có cược** only when the
carrier requires a deposit and enters its **estimated** amount. Intake must
not imply that this estimate is a confirmed payment. Refund deductions are
a separate financial case; the current full-refund action must not silently
represent a damaged-container deduction as a full cash receipt.

| Case | Source | Scenario and expected result |
|---|---|---|
| SIS22-DOC-001 | pp1–2 OPS | Invoice-backed lift/drop/other fees default to customer receivables; non-invoiced OPS costs and agreed customer charges remain separate, including zero charge and differing cost/charge. |
| SIS22-DOC-002 | p3 driver | Invoice-backed shipment costs reach receivables only after accountant confirmation. Non-invoiced driver costs and road money stay company costs. Check named fee presets and entered actual amounts. |
| SIS22-DOC-003 | pp4–6 accountant | Assigned-truck scope, OPS expense approval, road-money review/correction, individual/all selection and payer identity remain consistent across detail and summary. |
| SIS22-DOC-004 | pp4–5 cash | Company/ACB and TM sources are distinguishable; payment/receipt affects the selected account exactly once. Approved expense minus advance equals settlement balance, with the correct payer for each sign. |
| SIS22-DOC-005 | pp6–7 reports | Container weight and adjacent same-truck rows support reconciliation. Record the current monthly receivable/payable report behavior; the neighboring draft warning must be preserved in the coverage report. |
| SIS22-DOC-006 | pp8–10 debit | Filter dates/customer/carrier; pending freight adjustment blocks issue. Freight receivable/payable, LH and RU follow existing rates/overrides. Issue supports period, occurrence, VAT0/5/8/10 and notes without including unrelated road/OPS costs. |
| SIS22-DOC-007 | pp9–10 reconciliation | Margin equals transport receipts minus transport payables minus RU. Monthly summary respects customer/carrier scope, invoice/payment status, notes and excluding own fleet; downloaded XLSX agrees with displayed values. |
| SIS22-DOC-008 | pp10–11 combined invoice | Invoice number/amount and supplier payment remain separate; supplier invoice-service cost is included once in company costs. CUS can view the permitted tracker. |
| SIS22-DOC-009 | pp11–12 deposit | CUS deposit intent appears in tracker. Submission date defaults expected refund to +14 calendar days, editable; refund creates exactly one receipt in the configured company account. Filter/status totals, oldest outstanding ordering, +7-day missing-letter alert and outstanding-amount warning agree with saved data. |
| SIS22-DOC-010 | p12 all cost inputs | Add/remove draft rows and correct unapproved mistakes where permitted; approved/paid/locked costs follow existing adjustment or reversal rules and cannot be silently deleted. |

Each lane report maps these cases to actual actions, screenshots, requests and
database readback. Test-plan rows are intended coverage, not pass claims.

## Deposit tracker defects reproduced against production base

SIS22-DOC-009A: As `ketoan`, open **Thêm dòng**, enter the required bill,
customer/carrier and amount, leave the explicitly optional CV date blank, and
save. The browser submits null and the API rejects it with 400; the error is
behind the open modal. Accept an omitted/null optional date and display any
save error within its form. A typed negative amount must not become positive
through character stripping (the captured request converted -4000000 to
4000000). Validate whole positive VND without reinterpreting a sign/decimal.

SIS22-DOC-009B: Intake accepts a deposit without an amount, producing a tracker
with zero. The tracker exposes no amount editor, so the accountant cannot
complete it or record the refund. Add amount/note editing to its existing
finance-only update, retaining the row lock through validation and update so
it cannot race a refund. A refunded row is immutable. Verify zero/negative/
fractional/unsafe amounts rejected, CV clear/default/explicit override semantics,
and refund/edit concurrency with matching treasury and tracker amounts.

SIS22-DOC-009C: Default month filtering hides overdue unrefunded records from
previous months. Initial view must include outstanding history, while explicit
date/status filters continue to control displayed totals. Verify load failure
is visible with retry instead of falsely reporting an empty successful list.

SIS22-DOC-009D: Actual 390px rendering shows unstyled deposit amount/note
inputs and missing warning/total/status styling. Its page stylesheet exists
but is never imported. Load that stylesheet, use the shared input class,
keep the money table readable with contained horizontal scrolling, and check
form bounds at 320/390/820/1024/1440px.

SIS22-DOC-009E: With a refund confirmation displaying 4m, another accountant
changes the same unrefunded tracker to 5m. The existing refund sends only its ID
and posts 5m despite the displayed approval. Send the displayed amount and compare
it while holding the refund row lock. A mismatch must return 409 with no ledger,
treasury movement, refund stamp or durable success key, refresh the UI and require
a fresh confirmation. Verify the refreshed 5m succeeds exactly once and the same
command replays. Keep the existing empty-body API contract and upstream durable
endpoint/payload/response format for legacy clients; new UI always supplies the
expected amount. Preserve response-loss retry identity for all deposit commands.
