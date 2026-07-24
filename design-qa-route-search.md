# Design QA — Tìm kiếm tuyến đường

## Evidence

- Source visual truth: `/tmp/codex-remote-attachments/019f9287-4736-73b3-9ba7-1cf91aba69e3/B5BFE049-2305-4FBD-897B-2BC879C942E6/1-Photo-1.jpg`
- Browser-rendered mobile search state: `/Users/dev/Documents/projects/nepocorp/implementation-route-search-mobile.png`
- Browser-rendered mobile selected state: `/Users/dev/Documents/projects/nepocorp/implementation-route-selected-mobile.png`
- Browser-rendered desktop search state: `/Users/dev/Documents/projects/nepocorp/implementation-route-search-desktop.png`
- Full comparison board: `/Users/dev/Documents/projects/nepocorp/design-qa-route-search-comparison.png`
- Focused field comparison: `/Users/dev/Documents/projects/nepocorp/design-qa-route-search-focus.png`

## Capture normalization

- Source pixels: 796 × 1280. The source is a WhatsApp screenshot containing the requested mobile form and a text annotation, not a direct app capture.
- Mobile implementation: 390 × 844 CSS px at device scale factor 1; screenshot pixels are 390 × 844.
- Desktop implementation: 1440 × 900 CSS px at device scale factor 1; screenshot pixels are 1440 × 900.
- Full comparison board scales the source proportionally to 844 px high and places it beside the unscaled mobile implementation.
- Focused comparison crops the route-field regions and scales them to equal 500 px widths. The source shows the previous closed-select state; the implementation shows the requested search-open state. Exact state matching is impossible because the source does not contain a search-open design.

## Interaction state and browser checks

- Route: authenticated `/trips/new`.
- Mobile checks: opened the route selector, verified automatic focus in the search input, searched `ban bo`, confirmed the long catalog reduced to one matching route, selected it, and confirmed the trigger displayed `Hải Phòng - Bản Bo, Lai Châu`.
- Desktop checks: opened the full route catalog, confirmed the 320 px scrollable results area stayed aligned to the 326 px trigger without viewport overflow, searched `ban bo`, selected with Enter, and confirmed the form completion count changed from 8 to 7 missing required fields.
- Keyboard behavior covered: Arrow Up, Arrow Down, Enter, and Escape.
- Console errors: none.

## Full-view comparison

The implementation preserves the source hierarchy and field footprint: required trip card, customer field, route field, quick-route chips, and the following cargo field remain in the same order. Opening the field adds the requested inline search and bounded result list without shifting the page horizontally or obscuring the persistent mobile action bar.

## Focused comparison

- Fonts and typography: existing Be Vietnam Pro hierarchy remains consistent with the surrounding form; search and result text are readable at mobile size with no truncation.
- Spacing and layout rhythm: trigger width is unchanged; the popover aligns to it, maintains 48 px mobile touch rows, and uses a bounded scroll area for the long catalog.
- Colors and visual tokens: focus, active result, border, surface, and text colors use existing NEPO tokens and preserve the flat emerald visual system.
- Image quality and asset fidelity: no new image assets are required for this interaction; Search, Chevron, and Check use the repository's existing icon library.
- Copy and content: `Tìm tuyến đường…` communicates the new behavior directly; the no-result state is `Không tìm thấy tuyến đường phù hợp.` Route labels remain complete rather than truncated.

## Findings

- No actionable P0, P1, or P2 mismatch found.
- No P3 follow-up is required for the requested scope.

## Comparison history

- Initial browser comparison: passed. No visual fix iteration was required after the source and implementation were reviewed together.

## Implementation checklist

- [x] Searchable route selector on trip creation.
- [x] Searchable route selector on trip editing.
- [x] Accent-insensitive Vietnamese filtering.
- [x] Keyboard navigation and selection.
- [x] Mobile and desktop responsive verification.
- [x] Existing route-dependent form behavior preserved.

final result: passed
