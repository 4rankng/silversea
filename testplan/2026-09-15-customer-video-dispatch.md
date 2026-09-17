# Customer-video dispatcher regressions

Source: ScreenRecording_09-15-2026 19-32-38_1.MP4, frames30–34. Base ec46b398 plus preserved prior91-file patch. No commit or deployment. New source fixes require automated and actual-browser evidence separately.

| Case | Reproduce | Expected |
|---|---|---|
| VID-DSP-01 | Open plan editor, select task tags and type Vietnamese words one character at a time, including spaces and bare Enter; save and reopen. | Spaces and newlines survive; bare Enter does not submit; task labels remain separate from free notes. Preserve existing previous-patch composer fix. |
| VID-DSP-02 | Click the row Phát lệnh action on a ready assigned OWN or EXTERNAL row. Repeat rapid clicks while fleet lookup/mutation pending; force missing driver and API failure. | Direct release without scheduled-release fields or a confirmation dialog. Pending feedback prevents duplicate mutation; failure stays inline and supports retry; incomplete own-fleet data gives actionable error. Existing assignment editor still supports optional external driver information. |
| VID-DSP-03 | Mark both20ft rows Kẹp/DOUBLE, same truck+trailer+driver. Release first, then second with overlapping windows on same Vietnam business day, including start06:30 and07:30 crossing UTC calendar date. | Both releases succeed and retain distinct trip/container identities. No false duplicate-tractor rejection. Test through the dispatch endpoint after first trip is actually created and again after departure transition. |
| VID-DSP-04 | Repeat overlapping issuance with SINGLE classification, different driver/trailer/tractor,40ft shell, a third20ft container, existing unrelated active pair, different Vietnam day or duplicate fulfillment version. | Legitimate conflict/version/assignment checks remain enforced; no broad20ft double-booking bypass. Non-overlapping later runs remain allowed. |
| VID-DSP-05 | At video32–34 the customer asks for only a release icon. Open a ready row on desktop, phone and a coarse-pointer tablet; focus and click its release icon, then repeat clicks during lookup and release. Trigger a failed release and retry. | One compact icon action with descriptive accessible name and tooltip; no visible release text or scheduling dialog. A visible busy icon replaces the send icon while the button is disabled. The same target stays in place, duplicate clicks remain suppressed, inline errors remain readable and retry remains available. Desktop target is at least28px square; phone and coarse-pointer targets are44px square rather than a full-width empty row. |

Root drives real Chrome as dieuvan and records release/notes result plus database readback. Component/API tests do not certify physical-device or deployed staging behavior. Backend uses isolated test DB; browser fixture data is separate and explicitly identified.

VID-DSP-03 also covers the physical2×20ft load on a40FT moóc: vehicle suggestions and release validation agree. A20FT moóc is not sufficient for a DOUBLE load. VID-DSP-02 preserves Vietnam+07 fallback appointment hour when old rows omit runAt; browser timezone must not shift the issued trip.

VID-DSP-04 also checks known combined cargo: two individually valid20,000kg containers must not bypass a30,000kg moóc limit. Missing weight remains unknown rather than invented; known feasible pairs still release.
