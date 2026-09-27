# Kanban requirements reimplementation — visual and fleet

Source: all 38 assigned documents in Kanban-PROD; labels are not evidence.
Run on local full stack before patch delivery. Use authorized admin/dispatcher/OPS accounts and retain QA fixture identifiers in evidence. Phone 360/390/430, tablet 834, desktop1440.

| Case ID | Requirement and action | Expected behavior |
|---|---|---|
| KVIS-001 | Company profile: populated form, edit long name/email, compare saved values, save/cancel/reload | Save immediately follows editable controls; optional saved comparison collapsed initially, explicitly saved vs draft; malformed email field feedback and focus; valid/blank saved correctly |
| KVIS-002 | Config/module direct URLs and record tires at three widths | Compact visible heading/record identity, accessible heading same, correct back/action behavior without oversized banner |
| KVIS-003 | Fleet Ops owner picker: load, failed load/retry, new/inactive staff, >100 eligible users; assign/replace/clear | Complete eligible list with name+identifier, explicit loading/error/empty feedback, one owner persisted and OPS view reflects assignment |
| KVIS-004 | Template columns: first/middle/last/hidden/long label, select, edit, preview, navigate away, save | Selected identity and properties adjacent, no 20-selector traversal, selection stable, visibility/alignment/order/totals preserved; unsaved changes not silently discarded |
| KVIS-005 | Fleet: unknown trailer type, long plate; summary compare list; create/edit/reload | Unknown remains unknown in every presentation, totals reconcile and loading/error not zero; tablet plate/type intact; phone breakdown groups all readable |
| KVIS-006 | Searchable single/multiple selects: long catalog ArrowDown/Up, reopening late selection, filtering, clear/Escape | Active option visible by scrolling list only; keyboard input focus preserved; no page jump, valid empty index |
| KVIS-007 | Customers/factories and related directories: first records at three widths, view/edit long/empty fields | Identity/identifiers readable, secondary full details accessible explicitly, compact cards, no nested surfaces or clipping |
| KVIS-008 | Driver create footer at360/390/430/tablet/desktop and invalid draft | Required hint separate, intact text,44px actions, compact footer, correct validation/cancel |
| KVIS-009 | Ops dialogs and work queue at three widths, long/empty content | Overlay above header, close/focus/actions reachable; compact nonduplicated queue identity/blockers/next action |
| KVIS-010 | Trips/CUS/dispatch filters and tables three widths, empty/active filters | Records begin promptly, counts not duplicated, active criteria exposed, table/data no sticky overlap, filters preserve state |
| KVIS-011 | User create/edit combined invalid email/password; unit lifecycle create/reload/rename/deactivate/reactivate plus duplicate/stale | Vietnamese field feedback with focus, clear-on-correction; distinct duplicate/stale recovery, drafts/history preserved |
| KVIS-012 | Tire create/transfer/remove/reinstall/dispose same VN date with midnight boundary regression | Consistent Asia/Ho_Chi_Minh date,0days same day, historical dates unchanged |
| KVIS-013 | Fleet truck optional class/brand/note clear together and separately in both editors | Explicit null clear persists; untouched plate/relationships unchanged; version/idempotency retained |
| KVIS-014 | Config overview destinations and dashboard refresh | One entry per destination, correct counts/actions; no internal version token normal UI |
| KVIS-015 | Trigger a chunk-load fallback, Tab/Shift-Tab, append a late portal, remove handler, then retry manually at390/834/1440 | Background remains inert; focus stays on44px reload action; cleanup restores original inert/focus state; late recovery after cleanup creates no panel; manual reload remains available |

| KVIS-016 | Click user-editor, profile and password field labels; malformed optional email with sibling error; hidden metadata and icon-leading wrappers | Each label focuses its visible field, IDs stay unique, validation description resolves to the retained error element, decorative icons receive no field ID |
| KVIS-017 | Office and owning OPS recover historical advance drafts; negative amount, missing reason, cancel, record, void and reload at three widths | Required fields are visibly styled and labelled, invalid save is disabled, owner actions exist, direct record posts once, void posts nothing, immutable state survives reload |

## Coverage reporting
Per-document matrix: plans/260915-kanban-reimplementation/reports/visual-matrix.json. Code and automated tests are not browser sign-off. Explicit gaps include physical iOS camera/VoiceOver,24hour staging watch and deployment-specific chunk behavior unless actually executed in this run.
