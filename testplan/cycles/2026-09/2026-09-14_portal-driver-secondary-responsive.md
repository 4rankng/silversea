# Customer portal and driver secondary responsive polish

Date: 2026-09-14
Scope: customer portal layout/content, driver earnings/penalties/notifications/payslips/two-orders/e-POD, fleet and tires source inspection. Existing API, permissions, calculations, approval and connectivity behavior remain unchanged. No commit or deployment.

## Regression cases (recorded before implementation)

| Case | Steps | Expected result |
|---|---|---|
| RSP-PORTAL-01 | Open portal statement at 390×844, 834×1112 and 1440×900; fill both date fields, apply the period and use export controls. Repeat with a long customer identity and large balances. | Dates and actions fit their allocated space; no page-level horizontal clipping; titles and summary do not dominate the ledger; all values and controls remain readable. |
| RSP-PORTAL-02 | Open shipment detail and debit notes; switch tabs, inspect coordination history and acknowledge using the existing flow. | Content retains useful width on phone, long text wraps, timeline rows avoid redundant nested boxes; buttons remain reachable above navigation and preserve behavior. |
| RSP-DRIVER-01 | Load /my-payslips directly in a fresh page without first visiting /my-trips; inspect a period with salary, allowance and penalty. Repeat at phone/tablet/desktop and open its detail link. | Page-owned card styles are present on first entry; each metric remains labelled/readable and wraps without pushing beyond the card; the period link is unchanged. |
| RSP-DRIVER-02 | Load /my-trips/two-orders directly, inspect active/next or a persisted pair, and follow a card. | Existing driver-card layout is present on direct entry; cards remain distinct and route to the same assigned work. |
| RSP-DRIVER-03 | Open /my-earnings with four equation terms and long amounts, then inspect deductions. | Phone uses one compact divided equation surface rather than a card around every term; numbers remain readable without losing labels, calculations or signs. |
| RSP-DRIVER-04 | Open /my-penalties at 390, 834 and 1440 widths; inspect KPI values, long reason/note and month filter. | No reserved watermark gutter crowds the numbers; summaries are compact, month selector remains reachable and the reason/note does not force overflow. |
| RSP-DRIVER-05 | Open /notifications with unread count, long messages and mark-all action; focus and activate a row, then load more. | Header may wrap naturally, notification text is readable, actions retain keyboard focus visibility and normal behavior. |
| RSP-POD-01 | Open the existing e-POD screen; inspect photo notes and completion/recovery footer at three widths. | Notes wrap within the viewport and actions remain reachable; photo/completion requirements and mutations are unchanged. |

| RSP-FLEET-01 | Open /fleet at 390×844 with active/maintenance counts and trailers of unknown type; compare desktop/tablet. | Each count and its meaning stay together; groups wrap within the KPI card without clipping or shrinking text, and the same totals remain visible. |

| RSP-TIRES-01 | Open edit, unmount, install, transfer and position-manager dialogs on phone/tablet; open a position or supplier picker with the virtual keyboard consuming most of the height. | Dialog actions and close control remain reachable; the picker stays within the visible viewport and scrolls its options rather than forcing a 180px minimum outside it. |

## Verification responsibilities

The lead task owns the real Chrome session and will capture responsive interactions after rebuilding the combined work. This subtask records source inspection and command results only until that evidence exists. The lead has created a staging customer account and is capturing portal behavior; component checks cannot substitute for authenticated customer browser coverage. Do not report successful exports, acknowledgment, uploads or financial mutations from a rendered component alone.

Run focused existing frontend tests and lint with exact commands/output in qa/. The lead owns the final combined typecheck. The controller runs combined build/full gates after all authors finish. Cases requiring unavailable data remain explicitly open.

Tire scope clarification before implementation: this pass changes only dialog sizing, compact padding, action wrapping and visible close focus. Virtual-keyboard picker geometry remains a source-identified candidate needing a real keyboard reproduction; it is not claimed fixed by CSS.

## Follow-up recorded before shared inbox change

RSP-INBOX-01: Fresh customer /portal/shipments at390×844 showed status tabs on2+1rows and a full-width refresh row. Recheck at320,390,768and1440: the three labels/counts remain on one line (equal share when they fit; contained horizontal scroll when too narrow), each tab and refresh target stays at least44pxhigh onphone, heading uses18px and refresh shares its header row. Arrow/Home/End selection, counts, server reads and customer response handling remain unchanged. Repeat the shared component for Operations/Driver without changing data or submission behavior. Existing RoleWorkInbox and canvas-fit contract tests plus real browser geometry are the verification.

## Typography correction recorded before implementation

TYPO-ROLE-01: Compare customer inbox, portal shipment/statement, driver journey/detail/earnings/penalties/notifications, Fleet and tire pages at 320, 390, 768 and 1440px. Equivalent roles use the shared semantic scale across breakpoints. The final customer preference is compact moomoo-like density: body/data/controls/actions 12px, labels/captions 11px, section 14px, dialog 16px, page 18px and metrics 20px. Touch input values, placeholders and dropdown options also use 12px; the earlier 16px mobile exception is superseded. Preserve browser zoom and inspect native focus behavior on physical devices. Titles and values wrap instead of using a separate mobile size scale. Check large amounts, long route/plate names, inbox tabs and dialog headers/footers; phone penalty counts must share the first row with the monetary deduction occupying the next full row. Do not alter values, actions, approval or connectivity behavior. Focused component/style checks cover structural regressions; the lead owns the final combined build and browser recapture.

TYPO-INLINE-02: At phone/tablet/desktop widths, compare the Customers search input and Dispatch reassign external-plate/driver-name/driver-phone inputs with the shared field text size. These fields must follow --control-field-font-size instead of an inline13px exception. Config's empty-result heading and Audit Log's user-detail heading are section headings and must follow --text-section-size rather than raw15px. Preserve all input values, events and dialog actions. The lead owns live browser recapture; run focused source/component checks before handoff.
