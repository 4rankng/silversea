# Driver visual QA — 15 September 2026

Environment: local frontend, role `DRIVER` (`laixe`). Check 390px phone, 820px tablet and 1440px desktop; repeat overflow checks at 320px. Only manual browser visual checks are requested for this delivery. Source inspection alone is not a passed case.

| Case | Route / steps | Expected |
|---|---|---|
| DRV-VIS-001 | `/my-trips/:id`: click **Thông tin lệnh**, then **Thông tin xuất hóa đơn**, then expand both again. | Collapsed facts actually disappear and release their space; summary and chevron match the open state. Contact and invoice information remains available after expanding. |
| DRV-VIS-002 | Trip detail: inspect **Số cont & seal** read-only state, open an evidence thumbnail, edit and cancel. | One section boundary; container identity, seal and photo groups use simple separators instead of three nested cards. Full evidence image remains visible in thumbnails, including bottom watermark. Actions and captions fit at 320px. |
| DRV-VIS-003 | `/my-penalties`: inspect and open the month filter at every viewport. Switch month and observe loading and recoverable request failure. | Title and field align as a single toolbar; field has a bounded useful width, no oversized full-row control or clipped title. Changing months shows loading before scoped results, not stale all-time rows; failure offers retry. Current-period status must not claim no violations while its records are loading. |
| DRV-VIS-004 | `/my-earnings`: inspect summary, ledger, reminders and deductions; use an entry with long reason and large money amount. | Money remains legible with consistent alignment; mobile ledger headings wrap without overflow. Icon foreground has contrast. No extra 20px inner gutters in compact rows. |
| DRV-VIS-005 | `/my-trips`: inspect long route, port, task and seal values in all tabs. | Ports use aligned label/value columns; long identifiers wrap within the card. Header time and trip identity do not cause horizontal overflow. |
| DRV-VIS-006 | `/my-payslips` and `/my-trips/two-orders`: inspect loading, empty, populated and failed fetch states; click retry after a recoverable failure. | Stable page heading/insets, compact readable rows; failures offer an inline retry and loading feedback. Payslip amount is explicitly labelled; dates use Vietnamese day/month/year presentation. |
| DRV-VIS-007 | `/my-trips/:id/pod`: inspect both upload groups, missing-photo feedback, footer and back action. | Two upload groups and footer fit the viewport; footer clears bottom navigation. No redundant full viewport blank height below content. |
| DRV-VIS-008 | `/notifications`: inspect unread/read rows, **Đọc tất cả**, pagination and error retry. Also open account, profile and password surfaces from the shared shell. | Aligned touch controls, readable labels and no overflowing text. Shared-shell observations are reported to the controller. |
| DRV-VIS-009 | `/my-penalties`: with existing all-time rows, make the current salary-period lookup fail and retry it. | Current-period summary shows unavailable/retry and dashes, never a green no-violations claim or fabricated zero. All-time history remains visible; recovery restores the correct current-period summary. |

## Coverage

Implementation author: CODE-READ ONLY. Controller performs the actual browser interactions and records screenshots in `qa/2026-09-15_full-visual/`. No automated application tests, lint, typecheck or build run for this pass.
