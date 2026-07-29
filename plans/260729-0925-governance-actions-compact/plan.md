# Governance actions compact layout

Status: in_progress

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
- Each request uses a compact action footer with a one-line rejection input.
- Decision buttons remain readable but no longer dominate the request card.
- Focused tests, frontend typecheck, lint, and build are green with artifacts under `qa/`.
