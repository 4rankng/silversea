# Container details flat redesign

Status: Complete

## Goal

Redesign `ContainerInstancesCard` as a professional, compact logistics form
without nested cards or oversized empty photo surfaces.

## Scope

- Preserve container/seal data entry, OCR, upload, replace, delete, pending,
  lightbox, validation, and add/remove container behavior.
- Reshape only the feature-level JSX and CSS used by trip create/edit.
- Validate desktop, tablet, and mobile layouts.

## Non-goals

- No API, schema, RBAC, persistence, or deployment changes.
- No global design-system rewrite or Untitled UI package installation.

## Acceptance criteria

- One flat container record surface using headings, field groups, and dividers.
- Image evidence is compact, legible, and actionable in empty and populated
  states.
- No nested card-on-card treatment or oversized dashed drop zones.
- Destructive and capture controls have accessible names and at least 44 px
  touch targets.
- No horizontal overflow at 390 px; coherent intermediate and wide layouts.
- Affected frontend tests, typecheck, lint, and build are green with evidence
  under `qa/`, or unrelated blockers are recorded with exact output.

## Files

- `frontend/src/components/trip/ContainerInstancesCard.tsx`
- `frontend/src/components/trip/ContainerInstancesCard.css`
- `frontend/src/components/trip/ContainerInstancesCard.test.tsx`
- `plans/260726-2206-container-details-flat-redesign/reports/`
