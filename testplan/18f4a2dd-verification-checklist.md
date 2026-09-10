# Verification Master Checklist — 18f4a2dd
# Remove all phê duyệt (approval) flows

**Ticket:** 18f4a2dd
**Scope:** 6 clusters, 41 action kinds
**Staging:** https://vantai.tingting.vip
**Test accounts:** testplan/testaccounts.txt
**Status:** PRE-STAGE — ready to execute when backend chunk 7 lands + staging cut

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
- **Expected:** Period closes immediately. No approval request. Audit row preserved with AUTO/APPLIED semantics.
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
- **Check:** Salary approve/reject endpoints return 404 or are removed
- **Check:** No approve/reject buttons in salary UI
- **Evidence:** API test + UI screenshot

---

## Cluster C: Financial Maker-Checker (CHUNK 4)

### C1. Advance requests apply immediately
- **Action:** FORWARDER creates advance request
- **Expected:** Advance applied immediately (no pending-then-approve flow). Audit preserved.
- **Evidence:** Advance visible in records, audit trail shows AUTO/APPLIED

### C2. Credit overrides apply immediately
- **Action:** ACCOUNTANT creates credit override
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

### C6. Fuel invoice approval applies immediately
- **Action:** ACCOUNTANT approves fuel invoice
- **Expected:** Invoice approved immediately. No separate approval step.
- **Evidence:** Fuel invoice status = APPROVED

### C7. No dead approve/reject UI
- **Check:** No approve/reject buttons in financial forms
- **Check:** No PENDING status badges on financial records
- **Evidence:** UI screenshots of advances, credit overrides, debt offsets, payments

---

## Cluster D: OCR Fuel-Evidence Reviews (CHUNK 5)

### D1. OCR fuel-evidence decision applies immediately
- **Action:** ACCOUNTANT reviews OCR-scanned fuel evidence
- **Expected:** Decision (approve/reject) applies immediately. No separate approval gate.
- **Evidence:** Fuel evidence status updated

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
- **Check:** `approval.service.ts` endpoints return 404 or are removed
- **Check:** `GOVERNANCE_ACTION_KINDS` no longer referenced in active code
- **Evidence:** API test, code search

### F4. Governance transition/policy/action-core services removed
- **Check:** Related services are dead code or removed
- **Evidence:** Code search, no active imports

---

## Cross-Cutting Verification

### X1. No approval status chips/badges remain
- **Check:** Search entire UI for "PENDING_APPROVAL", "Chờ phê duyệt", "gửi yêu cầu"
- **Expected:** Zero matches
- **Evidence:** Grep results + UI screenshots

### X2. No dead approve/reject API endpoints
- **Check:** All approve/reject endpoints return 404
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

1. **Wait for backend chunk 7 to land + staging cut**
2. **Run Cluster A tests first** (the user's pain — highest priority)
3. **Run Clusters B-E** in any order (independent)
4. **Run Cluster F last** (depends on A-E being done)
5. **Run Cross-Cutting (X1-X5)** after all clusters pass
6. **Report to PM** with pass/fail per cluster + evidence
