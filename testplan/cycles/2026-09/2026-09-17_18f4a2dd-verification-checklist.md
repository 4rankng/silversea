# Verification Master Checklist — 18f4a2dd
# Remove all phê duyệt (approval) flows

**Ticket:** 18f4a2dd
**Scope:** 6 clusters, 41 action kinds
**Staging:** https://vantai.tingting.vip
**Test accounts:** testplan/testaccounts.txt
**Status:** Current criteria revised 2026-09-17; NOT TESTED for this revision.
**Canonical regression matrix:** [NO-APP-01..23](2026-09-17-no-approval-workflows.md). Preserve older execution evidence as historical, not current PASS.

---

## Cluster A: CUS Workspace Request/Approval (CHUNK 1) — THE USER'S PAIN

### A1. CUS container supplemental edit saves directly
- **Precondition:** CUS user creates shipment WITHOUT container number (day 1)
- **Action:** Next day, CUS opens shipment → "Chỉnh sửa thông số container" → enters container number (e.g. MSMU8456204)
- **Expected:** Edit SAVES DIRECTLY. No "gửi yêu cầu" prompt. No approval badge. No PENDING_APPROVAL status.
- **Evidence:** Screenshot of saved container with new number visible in ledger
- **Account:** CUS role (see testaccounts.txt)

### A2. CUS post-dispatch field edits save directly
- **Precondition:** Shipment has trip assigned (past dispatch cutoff)
- **Action:** CUS edits route/lift/drop fields on shipment
- **Expected:** Fields save directly. No "gửi yêu cầu cho Điều vận xem xét" message.
- **Evidence:** Screenshot of updated fields

### A3. CUS shipment reopen applies directly
- **Precondition:** Closed/completed shipment exists
- **Action:** CUS requests reopen
- **Expected:** Shipment reopens immediately. No approval flow. No PENDING_APPROVAL status.
- **Evidence:** Shipment status changes to active

### A4. CUS shipment delete applies directly
- **Precondition:** Shipment exists (non-critical)
- **Action:** CUS requests delete
- **Expected:** Shipment deleted immediately (or soft-deleted per current behavior). No approval flow.
- **Evidence:** Shipment no longer appears in list

### A5. No dead UI elements remain
- **Check:** No "Chỉnh sửa sau điều xe — thay đổi sẽ gửi yêu cầu cho Điều vận xem xét" subtitle
- **Check:** No pending-approval badges on CUS shipment rows
- **Check:** No request-mode UI in container edit dialog
- **Evidence:** Screenshots of container edit dialog, shipment list

---

## Cluster B: Salary Period Governance (CHUNK 3)

### B1. Salary period close applies immediately
- **Action:** MANAGER/ADMIN closes a salary period
- **Expected:** Period closes immediately. No approval request. Direct action audit preserved; no simulated make/check/approve transitions.
- **Evidence:** Salary period status = CLOSED, audit log entry exists

### B2. Salary period reopen applies immediately
- **Action:** MANAGER/ADMIN reopens a closed salary period
- **Expected:** Period reopens immediately. No approval flow.
- **Evidence:** Salary period status = OPEN

### B3. Salary adjustments apply immediately
- **Action:** ACCOUNTANT creates salary adjustment
- **Expected:** Adjustment applied immediately. No approval gate.
- **Evidence:** Adjustment visible in salary records

### B4. No dead approve/reject endpoints
- **Check:** Retired salary decision routes return the documented 404/410 unavailable response and cannot mutate
- **Check:** No approve/reject buttons in salary UI
- **Evidence:** API test + UI screenshot

---

## Cluster C: Financial Maker-Checker (CHUNK 4)

### C1. Advance requests are recorded without creating cash
- **Action:** OPS creates an advance request; finance separately records actual funding.
- **Expected:** Request saves directly but adds no cash. Actual funding changes the correct wallet/fund once with payment reference, authorization and audit.
- **Evidence:** Request, funding reference and balances before/after; retry does not duplicate money.

### C2. Credit overrides apply immediately
- **Action:** An authorized financial role directly records a permitted credit change or exception
- **Expected:** Override applied immediately. No PENDING table row.
- **Evidence:** Credit override visible, no pending status

### C3. Debt offsets apply immediately
- **Action:** ACCOUNTANT creates debt offset
- **Expected:** Offset applied immediately.
- **Evidence:** Debt balance updated

### C4. Payment allocations apply immediately
- **Action:** ACCOUNTANT allocates payment
- **Expected:** Allocation applied immediately.
- **Evidence:** Payment allocation visible

### C5. Profit distribution applies immediately
- **Action:** MANAGER distributes profit
- **Expected:** Distribution applied immediately.
- **Evidence:** Profit distribution records updated

### C6. Fuel invoice records directly
- **Action:** Authorized accountant records or corrects a valid fuel invoice.
- **Expected:** Existing allocation, amount and evidence rules apply; record once without an approval state or second actor.
- **Evidence:** Saved invoice, source cost and audit; adding photos does not duplicate costs.

### C7. No dead approve/reject UI
- **Check:** No approve/reject buttons in financial forms
- **Check:** No pending-approval badges; genuine unpaid/unfunded/incomplete-document states remain distinct
- **Evidence:** UI screenshots of advances, credit overrides, debt offsets, payments

---

## Cluster D: OCR Fuel-Evidence Reviews (CHUNK 5)

### D1. OCR evidence records directly
- **Action:** User with existing permission checks OCR values and corrects the source evidence.
- **Expected:** Saved values and OCR uncertainty reflect actual facts; no approve/reject action or queue. Receipt changes do not duplicate financial effects.
- **Evidence:** Source evidence values, owner scope and immutable history.

### D2. No dead OCR approval UI
- **Check:** No separate approval step in OCR review flow
- **Evidence:** UI screenshot of OCR review page

---

## Cluster E: App-Settings Policy Requests (CHUNK 6)

### E1. Financial reporting policy changes apply immediately
- **Action:** ADMIN changes financial reporting policy settings
- **Expected:** Changes applied immediately. No request-then-approve flow.
- **Evidence:** Setting value updated

### E2. Truck profile changes apply immediately
- **Action:** ADMIN changes truck profile settings
- **Expected:** Changes applied immediately.
- **Evidence:** Setting value updated

### E3. No dead policy request UI
- **Check:** No request/approve buttons in app-settings
- **Evidence:** UI screenshot of settings pages

---

## Cluster F: Governance Core + Queues (CHUNK 7, LAST)

### F1. Governance actions table preserved
- **Check:** `governance_actions` table still exists with historical data
- **Check:** No new rows are being created (clusters A-E no longer feed it)
- **Evidence:** DB query showing historical rows, no new PENDING_APPROVAL rows

### F2. Dashboard approval queue removed or empty
- **Check:** `/dashboard/approval-queue` returns empty or is removed
- **Check:** No `ApprovalQueueCard` or `ManagerDecisionInbox` components rendered
- **Evidence:** Dashboard screenshot, API response

### F3. Dead governance services removed
- **Check:** Retired approval endpoints return documented 404/410 responses and cannot mutate
- **Check:** `GOVERNANCE_ACTION_KINDS` no longer referenced in active code
- **Evidence:** API test, code search

### F4. Governance transition/policy/action-core services removed
- **Check:** Related services are dead code or removed
- **Evidence:** Code search, no active imports

---

## Cross-Cutting Verification

### X1. No approval status chips/badges remain
- **Check:** Search active controls/status labels for pending approval, approver and submit-for-approval wording.
- **Expected:** No active approval workflow. Historical audit descriptions remain readable; a funding request or driver acceptance is not an approval.
- **Evidence:** Grep results + UI screenshots

### X2. No dead approve/reject API endpoints
- **Check:** Retired approve/reject endpoints return documented 404/410 responses, including legacy aliases
- **Expected:** No 200/201 on approve/reject calls
- **Evidence:** curl tests for each removed endpoint

### X3. Audit history preserved
- **Check:** Historical governance_actions rows intact
- **Check:** Past approval decisions visible in audit logs
- **Evidence:** DB query showing historical data

### X4. No regression in direct-save flows
- **Check:** CUS container edit still works (A1)
- **Check:** Financial records still save correctly (C1-C6)
- **Check:** Salary operations still work (B1-B3)
- **Evidence:** Re-run A1, B1, C1 after each chunk

### X5. RBAC still enforced
- **Check:** CUS cannot perform ADMIN-only actions
- **Check:** DRIVER cannot access financial flows
- **Expected:** 403 on unauthorized attempts
- **Evidence:** API tests with wrong-role accounts

---

## Execution Order

1. **Use the local branch and current NO-APP criteria; do not reuse historical PASS**
2. **Run Cluster A tests first** (the user's pain — highest priority)
3. **Run Clusters B-E** in any order (independent)
4. **Run Cluster F last** (depends on A-E being done)
5. **Run Cross-Cutting (X1-X5)** after all clusters pass
6. **Report to PM** with pass/fail per cluster + evidence
