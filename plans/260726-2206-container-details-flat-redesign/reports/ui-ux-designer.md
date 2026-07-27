# UI/UX recommendation — Chi tiết container

## Outcome

Redesign the editor as a compact, flat operations form: one continuous surface, one clear row per evidence type, and thin dividers between containers. Do not render a rounded container card around each `Cont`, and do not place photo “cards” inside it. Preserve every current capability:

- add/remove container;
- enter and validate container number, including suggested correction;
- enter weight and container notes;
- enter, clear, and annotate 2 seals;
- capture/OCR, view, replace, and remove container/seal photos;
- show upload/delete busy state and `chưa lưu`;
- show required-photo warning, loading state, no-container state, scanner, viewer, and the existing page-level `Lưu cập nhật` workflow.

Visual direction: industrial/utilitarian, content-first, zero elevation. Use the existing local typography, colors, icons, and semantic tokens. No new font, library, global token, shadow, gradient, or decorative container.

## Screenshot diagnosis

The reference surface is readable but inefficient:

- One container consumes more than a viewport because each empty image is a full-width 128px panel and every evidence lane repeats a large heading/action/box stack.
- The outer rounded `Cont #1` panel plus inner dashed photo panels creates nested-card hierarchy.
- Container identity, evidence, and metadata are separated by large vertical gaps, so users cannot scan one container as a single operational record.
- “Đổi ảnh” and the large photo area compete for attention with the form; the page-level save remains the actual completion action.
- The populated container image is visibly broken in the screenshot. The UI needs an explicit failed-image fallback rather than exposing a browser broken-image glyph and alt text.
- Delete actions are visually remote from the values they affect. A red icon alone also does not communicate whether it deletes a photo, seal values, or the whole container without its accessible label/title.

## Flat information hierarchy

Use this order for every container:

```text
Cont 01       [optional evidence status]                         [Xoá cont]
Số container                 Trọng lượng (kg)                    Ghi chú
[value + inline warning]     [value]                             [value]
────────────────────────────────────────────────────────────────────────
Ảnh container   [thumbnail / empty]       [Chụp ảnh | Đổi ảnh] [Xoá ảnh]
────────────────────────────────────────────────────────────────────────
Seal 1          [Số seal] [Ghi chú]        [thumbnail / empty]  [Chụp/Đổi] [Xoá]
────────────────────────────────────────────────────────────────────────
Seal 2          [Số seal] [Ghi chú]        [thumbnail / empty]  [Chụp/Đổi] [Xoá]
════════════════════════ divider between containers ═════════════════════
```

Implementation intent:

- The page section title and explanation remain above the editor.
- Each container is a semantic section (`fieldset`/labelled group), not a visual card.
- `Cont 01` is a compact 44px minimum-height header row. Use two-digit numbering for stable alignment when the list grows.
- Put container number, weight, and notes together as the primary identity row. This removes the current distance between number and weight.
- Convert the three image areas into evidence rows. Use a 1px existing-token divider and alignment, not background panels or border radii, to show grouping.
- Treat seal number, seal note, and its photo as one row. This makes the number-to-proof relationship immediately legible.
- Keep the container-number warning directly below its input. The correction action remains beside/below the warning and must wrap without covering the next column.
- Separate containers with 20–24px vertical space plus one stronger divider. Do not alternate card backgrounds.
- Keep `Thêm cont` after the list as a secondary action. Keep the existing helper text about `Lưu cập nhật`, but shorten it to `Lưu cùng nút “Lưu cập nhật” bên dưới.` and place it as muted support text.

Optional evidence status in the container header may be textual, e.g. `2/3 ảnh`, only if calculated from current state without changing validation. Do not use color alone or introduce a new completion rule.

## Responsive behavior

Prefer component/container queries because this editor can sit inside different page widths.

### Desktop — content width ≥ 900px

- Identity row: `minmax(260px, 1.2fr) minmax(160px, .55fr) minmax(280px, 1fr)`.
- Evidence rows: label column 120–136px; data area fluid; thumbnail 112×80px; actions auto-sized at the right.
- Seal rows keep number (180–220px), note (fluid), thumbnail, and actions on one line.
- Align every evidence row to the same column grid so users can compare container/seal proof vertically.
- Avoid a large fixed blank upload target. The compact empty thumbnail and labelled capture button are sufficient affordances.

### Tablet — content width 600–899px

- Identity becomes 2 columns: container number and weight on the first line; notes span both columns.
- Each evidence row becomes a 2-column grid: label/fields at left, thumbnail/actions at right.
- Seal number and note may share the left area when space permits; below roughly 720px, note moves under number.
- Keep action labels visible; do not reduce capture/change/remove to ambiguous icon-only controls.

### Mobile — content width < 600px

- Use one column and 16px side padding; no horizontal scrolling.
- Container header remains a single line with the destructive action at the end.
- Identity fields stack in task order: container number, weight, notes.
- Each evidence row stacks as: row label → seal fields when applicable → compact media strip.
- Media strip: 88×66px thumbnail/empty state at left; `Chụp ảnh` or `Đổi ảnh` text button at right; remove action beside it or on a second line at 320px.
- Inputs stay at least 44px high and at least 16px text to avoid mobile zoom. Buttons remain at least 44×44px with 8px separation.
- At 320px, allow action text to wrap naturally; never truncate the container/seal number or cause page overflow.
- Do not collapse containers into accordions by default. Keeping entered values visible avoids hidden validation and preserves the existing workflow.

## Image states

### Empty

- Show a compact dashed thumbnail slot, not a full-width drop zone.
- Use the existing image-off icon plus `Chưa có ảnh`.
- The slot and adjacent `Chụp ảnh` button may trigger the same scanner action, but both need clear accessible names.
- Required-photo state: retain the single warning above the list. If field-level indication is added, use `Cần ảnh` text with warning icon; do not use border color alone.

### Populated

- Show a fixed-aspect thumbnail with `object-fit: cover`; clicking it opens the existing viewer.
- Adjacent actions: `Đổi ảnh` as secondary, `Xoá ảnh` as danger/ghost. Do not overlay the remove control on the image unless the 44×44 hit target and contrast remain reliable.
- Render `Chưa lưu` as a small status line/badge next to the thumbnail, not over important image content. Announce the state to assistive technology.
- During upload/delete, keep dimensions fixed, disable the affected controls, and use `Đang tải ảnh…` / `Đang xoá ảnh…` accessible status text.

### Failed image

- Replace the native broken-image rendering with a bounded fallback in the same thumbnail dimensions: image-off icon, `Không tải được ảnh`, and `Thử lại` or `Đổi ảnh`.
- Preserve the storage reference until the user explicitly removes/replaces it. A load failure is not proof the persisted photo should be deleted.
- Use descriptive alt text when loaded, e.g. `Ảnh container LQSU1077373` or `Ảnh seal 1 của container LQSU1077373`; use a useful fallback when the number is empty.

## Action hierarchy

1. `Lưu cập nhật` remains the only primary completion action and stays at page level.
2. `Thêm cont` is secondary and appears once after the list.
3. `Chụp ảnh` / `Đổi ảnh` are local secondary actions.
4. Thumbnail/view is a quiet content action.
5. `Xoá ảnh`, `Xoá seal`, and `Xoá cont` are destructive/ghost actions. Keep their targets explicit in accessible names.

For `Xoá cont`, request confirmation when the row contains entered data or photos; an untouched empty row may be removed directly. For a populated seal, use `Xoá dữ liệu seal 1/2`, not the ambiguous `Xoá seal`, because the action clears values rather than deleting a separate record from view.

## Accessibility and interaction requirements

- Associate every visible label with its input via `htmlFor`/`id`; placeholders are examples, not labels.
- Group each container with a `legend`, and each seal/evidence row with a meaningful heading or accessible group label.
- Maintain logical keyboard order: container identity → container photo → seal 1 fields/photo → seal 2 fields/photo → metadata/actions.
- Use native buttons. Decorative Lucide icons use `aria-hidden="true"`; icon-only controls retain specific `aria-label`.
- Provide visible `:focus-visible` treatment using existing focus/ring tokens. Never remove outlines without replacement.
- Normal text contrast ≥ 4.5:1; boundaries and large icons ≥ 3:1. Warning/destructive meaning includes icon and text, not color alone.
- Use `aria-live="polite"` for OCR, upload, delete, pending, and image-load feedback; busy controls expose `aria-busy` and disabled state.
- Error/warning copy states the issue and recovery action. Focus the first invalid field after save validation.
- All touch targets ≥ 44×44px, with ≥ 8px between adjacent targets.
- Any hover color change has an equivalent focus/pressed state. Use 150–200ms color/border/opacity transitions only and respect `prefers-reduced-motion`.
- Reserve thumbnail width/height to prevent layout shift; lazy-load below-fold photos.
- Long Vietnamese notes and OCR values wrap or remain fully editable; no clipping at 200% text zoom.

## Component-scoped styling guidance

- Reuse current semantic variables such as `--line`, `--fg-*`, `--surface`, `--danger`, warning tokens, and current input/button classes.
- Remove the per-container rounded background/border treatment and the 128px full-width photo wells.
- Add only `ci-*` selectors to the existing component stylesheet. No global styles or tokens.
- Use CSS grid/flex and container queries; no JavaScript width measurement.
- Keep borders square or at the existing small input/thumbnail radius. Avoid creating new “mini cards” around evidence rows.
- Existing Lucide imports are sufficient; add no package.

## Design QA checklist

- [ ] At 1440px, one complete container record is scannable without nested panels; number, weight, notes, and 3 evidence rows align.
- [ ] At 768px, no label/action collision; note fields and media actions reflow predictably.
- [ ] At 390px and 320px, no horizontal overflow; every field and action remains visible and ≥44px.
- [ ] Test 0, 1, and multiple containers; long numbers/notes; both seals empty/populated.
- [ ] Test photo empty, loaded, pending, upload busy, delete busy, and failed-image fallback for container and both seals.
- [ ] Verify capture/OCR, view, replace, remove, suggested-number correction, clear seal, add/remove container, and page-level save all remain available.
- [ ] Keyboard-only: order, focus visibility, viewer/scanner close behavior, destructive confirmation, and return focus.
- [ ] Screen reader: labels/groups, image descriptions, `aria-busy`, pending status, OCR/toast announcements, and explicit delete targets.
- [ ] Contrast, 200% zoom, and reduced-motion checks pass.
- [ ] No shadow, gradient, nested card, global token change, new library, or decorative layout shift introduced.

Status: DONE

Summary: Compact flat row-and-divider redesign specified for desktop, tablet, and mobile, including complete image-state and action behavior while preserving the existing container workflow.

Concerns/Blockers: The screenshot shows a failed container thumbnail; implementation should verify whether the cause is only rendering/error handling or an invalid photo URL before changing persistence behavior. The mandated skill virtualenv was absent, so the UI intelligence searches ran successfully with the available system Python 3.9.6.
