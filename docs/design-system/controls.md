
Phone ledger matrices use `components/shared/LedgerRecordList`: mount only at<=640px, show primary labelled facts and disclose the remaining original fields with native “Chi tiết”. The labelled checkbox owns selection; expanding/details actions do not select. Lists paginate20records locally with explicit range. `ledger-desktop` preserves the matrix at tablet/desktop and in print; phone records do not duplicate desktop controls at wider viewports. This implements the operator's2026-10-01 rejection of phone columns hidden offscreen (QA-AUDIT-UI-31).

Prefix dates retain one visible boundary: `BufferedUuiDateInput` owns one inner
`data-date-boundary` around prefix/segments, with border/focus/error chrome; `styles/base.css` paints that wrapper
and its disabled/read-only states. The outer labelled column keeps helpers
below the boundary, while DateRangeFields top-aligns both endpoints. Its nested segment group remains transparent.
The shared licensed `control-geometry.css` gives the group and digit wrappers
the outer height minus two border pixels, overriding shared filter floors at
that structural owner. Standalone date groups retain their own surface and
geometry. No overflow clipping is needed (QA-AUDIT-UI-53).

Legacy native `input--sm` lives in `components/Input.css`:30px compact
height and house typography. Trip editors inherit this owner or ordinary
Input/Button geometry rather than overriding heights in page/card CSS.
Photo action targets are separate from media/content dimensions (UI54).

Shared ContainerScanner round actions and shutter also consume `--control-h`;
DriverContainer capture uses horizontal icon/label control anatomy, while
camera/video/photo preview sizes are independent. Its former72px capture
action tiles and44px scanner actions are superseded by the current ceiling.


Filter feedback alignment (UI56): the shared FilterBar retains bottom alignment for normal
labelled stacks. Direct prefix-date/search error feedback switches that state
to top alignment; the helper remains below its own field in normal flow and
reserves space before the next wrapping row. Folded criteria retain their
existing dialog layout. No page-specific selector or fixed feedback height.

The existing trip-edit narrow footer complements the shared desktop-only
cutoff at820px, so641–820px never loses Save/Cancel. Its existing Button
geometry and handlers stay shared; media and multiline content are separate.
