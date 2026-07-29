# Governance actions compact-row design QA

## Comparison target

- Source visual truth:
  - `/var/folders/8j/qs8k8y3n1hlfbl4q20k0hgjh0000gn/T/codex-clipboard-fba47276-204b-4aa2-ae69-d0e1915e00f6.png` — 3250 × 860 px.
  - `/var/folders/8j/qs8k8y3n1hlfbl4q20k0hgjh0000gn/T/codex-clipboard-c398455c-3d8f-4cf1-be6c-27263a53a680.png` — 1544 × 1000 px.
- Rendered implementation:
  - `qa/2026-07-29_governance-actions-row_desktop.final.png` — 1332 × 900 px from a 1440 × 900 CSS viewport.
  - `qa/2026-07-29_governance-actions-row_mobile.final.png` — 390 × 844 px from a 390 × 844 CSS viewport.
- Focused comparison:
  - `qa/2026-07-29_governance-actions-row_comparison.png` — source request normalized to 1332 px width above the final 1048 × 222 px implementation crop.
- State: authenticated local ADMIN, pending price-configuration requests, light theme.
- Density normalization: device scale factor 1. The desktop in-app-browser capture produced 1332 output pixels for the 1440 CSS-pixel viewport; the source request was proportionally resized to 1332 px for the focused density comparison.

## Full-view comparison

- Typography: existing product font, weights, and hierarchy remain consistent. Card titles and metadata are smaller without becoming illegible.
- Spacing and layout: request cards no longer contain an oversized form panel. A non-actionable request measures about 222 px on desktop and 297 px at 390 px mobile.
- Colors and tokens: existing semantic status, approval, and rejection tokens are preserved; no new palette or elevation style was introduced.
- Image and icon fidelity: no raster assets are present in this operational surface. Existing Lucide action and permission icons are preserved.
- Copy and content: all request facts, reason, status, and server-authorized permissions remain visible. The two version fields are combined as `YC … · Gốc …`.
- Responsiveness: body width equals viewport width at 390 and 1440 CSS px. Mobile metadata uses a three-column compact row after the full-width subject, and actionable buttons remain 44 px high.

## Focused comparison

The source request devoted most of its height to a disabled multiline rejection form and oversized buttons. The final request uses an inline reason, compact permissions footer, a one-line rejection input only when rejection is authorized, and only renders executable decision buttons. The comparison is sufficiently legible to judge metadata rhythm, reason presentation, permission placement, and the removal of dead controls.

## Comparison history

1. Initial finding — P1: every pending request rendered a large textarea and three buttons even when all decision buttons were disabled.
   - Fix: changed the textarea to a text input and conditionally render the decision area only when `CHECK`, `APPROVE`, or `REJECT` is actually authorized.
2. Initial finding — P2: metadata and decision controls still consumed excessive vertical space on mobile.
   - Fix: combined request/data versions into one field, used three compact mobile metadata columns, reduced desktop controls to 34 px, and kept mobile controls side-by-side at 44 px.
3. Post-fix evidence:
   - Desktop non-actionable request: approximately 222 px high.
   - Desktop actionable request: approximately 224 px high.
   - Mobile non-actionable request: approximately 297 px high.
   - Mobile actionable request: approximately 389 px high.
   - Rejection input accepted and cleared a test value; no mutation was submitted.
   - Browser console errors: none.

## Findings

No actionable P0, P1, or P2 visual differences remain for the requested compact-row redesign.

## Primary interactions tested

- Pending/all filter content remained rendered.
- Rejection reason is a native single-line `INPUT`.
- The authorized rejection input accepted text and was cleared without submitting.
- Only server-authorized decision buttons are rendered.

final result: passed
