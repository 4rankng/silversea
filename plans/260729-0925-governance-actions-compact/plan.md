# Governance actions compact layout

Status: complete

## Goal

Remove the obsolete maker/checker/approver eyebrow and make `/governance-actions` compact and data-dense without changing governance behavior or server-authorized actions.

## Scope

- `frontend/src/pages/GovernanceActionsPage.tsx`
- `frontend/src/pages/GovernanceActionsPage.css`
- `frontend/src/pages/GovernanceActionsPage.test.tsx`

## Acceptance criteria

- The removed eyebrow text is not rendered.
- Existing queue filtering, evidence, permissions, and mutations remain intact.
- Desktop uses materially less vertical space while preserving readable data.
- Mobile has no horizontal overflow and keeps usable touch targets.
- Focused tests, frontend typecheck, lint, and build are green with artifacts under `qa/`.
