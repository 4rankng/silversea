# Chat area mobile scroll QA

## Comparison target

- Source visual truth: `/tmp/codex-remote-attachments/019f8ffa-d385-71a2-bb72-1dcfe0ab064c/EA081015-1045-4C6E-BCFB-FD4874AC8900/1-Photo-1.jpg`
- Browser-rendered implementation: `/Users/dev/Documents/projects/nepocorp/chat-area-mobile-fixed.jpg`
- Combined comparison: `/Users/dev/Documents/projects/nepocorp/chat-area-mobile-comparison.jpg`
- Viewport: 393 × 852 CSS px
- Source pixels: 588 × 1280. Normalized to 393 × 855, then cropped by 55 px at the top to remove iOS-owned status chrome.
- Implementation pixels: 393 × 852 at device scale factor 1. Cropped to the first 800 px for the combined app-content comparison.
- Compared state: mobile assistant drawer containing a viewport-taller structured insight card, with the composer fixed below the scrollable thread.

The source and implementation contain different live report data, so this is a behavioral layout comparison rather than a copy-for-copy design recreation. The affected invariant is whether the newest structured card begins immediately below the assistant header instead of opening at its bottom.

## Findings

No actionable P0, P1, or P2 findings remain for the reported bug.

- Fonts and typography: the existing TingTing font families, weights, hierarchy, and wrapping were preserved. The fixed capture shows the report title and summary fully readable at the top of the thread.
- Spacing and layout rhythm: the drawer header remains 101.875 px high; the report card starts at 102.172 px while the thread starts at 101.875 px. The 0.297 px difference is subpixel rendering, so the card is aligned to the thread start without overlap or an unintended gap.
- Colors and visual tokens: the existing accent remains the enabled send state and existing neutral surface/ink tokens now keep the disabled icon visible. No new palette values were introduced.
- Image quality and asset fidelity: the supplied assistant asset remains sharp and correctly sized. No image or icon asset was replaced.
- Copy and content: no application copy changed. The browser check used a live deterministic financial report to exercise the same tall-card layout class shown in the source.
- Persistent controls: the composer remains fixed and spans the available drawer width while the card body scrolls independently. Its input takes the remaining row width and the send control is a visible 44 × 44 px icon button on the right.

## Full-view comparison evidence

The source shows the newest card already scrolled down: its title, summary, and leading KPI content are above the visible thread. In the post-fix capture, the newest card title begins directly below the header and its KPI grid follows in normal reading order.

The live browser geometry after initial render and after reopening the drawer was identical:

- thread top: 101.875 px
- card top: 102.172 px
- title top: 118.172 px
- thread scrollTop: 72 px, accounting for the preceding user message while aligning the assistant card itself to the top

## Focused region comparison evidence

The combined comparison focuses on the app-owned header, thread, and composer. It excludes the source image's iOS status bar and bottom device chrome. No additional close-up was needed because the card title, KPI grid, action cards, scrollbar, and composer are legible at the normalized 393 px width.

## Comparison history

1. Initial P1 finding: repeated bottom-sentinel alignment opened a tall insight card at its end. The source screenshot shows the leading report content clipped above the viewport.
2. Fix: newest finalized `insight_card` responses now align their root element to the thread start; ordinary text and streaming replies retain bottom pinning. The pinned state is updated synchronously to prevent a competing smooth bottom-scroll during the same layout cycle.
3. Post-fix evidence: the live 393 × 852 render shows the full report title and summary below the header. Closing/reopening the assistant preserved the same top alignment. Browser console errors: none.
4. Composer refinement: the input row was widened to the drawer margins and the text-based send control was replaced with an icon-only button. The final browser geometry is 364 px for the composer, 292 px for the input, and 44 × 44 px for the send button at a 393 px viewport. The disabled button remains visible using neutral semantic tokens.

## Primary interactions tested

- Opened the assistant from the mobile top bar.
- Submitted a report query and waited for the structured response.
- Confirmed the report title and leading KPIs are visible.
- Reopened the persisted report and confirmed the same alignment.
- Confirmed the composer remains visible and the thread remains independently scrollable.
- Confirmed the full-width composer exposes an accessible `Gửi tin nhắn` icon button.

## Residual test gaps

- The supplied source screenshot contains different report data from the deterministic local response, so exact copy and per-widget height were not compared.
- Device-specific iOS browser chrome and virtual-keyboard resizing were outside the app-owned viewport and were not reproduced.

final result: passed
