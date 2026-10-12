# Regression spec — FB-005 detail-page declaration affordances

**Ticket:** FB-005 (round 16) — card 121026141000
**Owner (implement):** frontend
**Owner (verify):** qa
**Status (this doc):** covered by unit cases + local UI drive
**Cycle:** 2026-10 round 16

## Goal

On `/shipments/:id` (FCL detail), the 'Tờ khai hải quan' section showed only
read-only cards (or 'Chưa có tờ khai nào.') with no way to add or remove a
declaration, while declaration CRUD (POST/PUT/DELETE `/:id/declarations…`)
and the write-role model already exist and serve the CUS quick-edit modal.
Restore the section affordances: '+ Thêm tờ khai' button and a per-row delete
control, gated to the declaration write roles and disabled under an active
accounting lock — the same semantics the workspace fieldAccess gives
`declarationNumber` (CUS/ADMIN/MANAGER direct; locked lot read-only).

## Acceptance criteria

### TC-FB005-001 — Add affordance renders for write roles

- **Given** an ADMIN (or CUS) account on an unlocked lot's detail page
- **Then** the 'Tờ khai hải quan' section header shows a '+ Thêm tờ khai'
  button, also when the lot has zero declarations.

### TC-FB005-002 — Role gating stays intact

- **Given** ACCOUNTANT / DISPATCHER / DRIVER / OPS on the same page
- **Then** neither the add button nor any row delete control renders.

### TC-FB005-003 — Per-row delete + confirm

- **Given** a lot with an existing declaration
- **When** the row delete is tapped and confirmed
- **Then** DELETE `/api/shipments/:id/declarations/:declarationId` fires and
  the refetched section no longer lists the row.

### TC-FB005-004 — Add requires a number, then creates

- **Given** the add modal
- **Then** confirm stays disabled until a non-empty 'Số tờ khai' is typed;
  on confirm POST `/api/shipments/:id/declarations` fires with the trimmed
  number and the section refetches. A 409 duplicate surfaces the API message
  inside the modal.

### TC-FB005-005 — Accounting lock disables both affordances

- **Given** a lot with an active accounting lock
- **Then** add button and row deletes render disabled with the lock reason.

## Out of scope

- Editing an existing declaration number from the detail page (stays in the
  CUS quick-edit documents flow); backend behavior; create page.
