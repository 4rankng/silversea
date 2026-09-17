# Customer video — CUS intake and detail regressions

Source: ScreenRecording_09-15-2026 19-32-38_1.MP4, 00–10s and 36–39.6s. Target roles: CUS. Preserve the separate adaptive date/time controls and all previously delivered changes. Changes remain uncommitted.

| Case | Reproduction | Expected behavior |
| --- | --- | --- |
| VID-CUS-01 | Create an FCL lot with a shipment-level catalog factory, no legacy factory text, and a container inheriting the site; compare overview and container detail. | Both show the same catalog short name. A container-specific factory takes precedence. |
| VID-CUS-02 | Enter a Bill, Booking, or declaration containing `_` or `%` beside similar existing references; repeat an actual reference with different casing. | Punctuation is literal; only exact trimmed case-insensitive duplicates are blocked. The correct field shows the original creator. |
| VID-CUS-03 | Type a duplicate reference in lowercase; clear it while its lookup is in flight; enter a short declaration beside a duplicate full Bill. | Matching ignores casing, stale results cannot reappear, and one short field does not disable checks for other complete fields. |
| VID-CUS-04 | Save a new lot with a unique Bill and a declaration already attached to another lot; repeat with a new declaration and replay the same request. | Conflict leaves no partial shipment; valid shipment plus initial declaration persist together, and retry returns the same records. |
| VID-CUS-05 | Open two historical lots sharing one Bill; add a date to the undated lot by its record ID. | Only the selected lot changes; unchanged historical duplicate identity does not block date editing. |
| VID-CUS-06 | Save without appointment, then type a 24h appointment and Enter or use the visible save control. | Undated save succeeds; completed appointment persists and detail drawer closes without a discard warning. |
| VID-CUS-07 | Search an existing container, Bill and declaration using its full value and last four/five characters. | Correct rows remain discoverable with each accepted search. |
| VID-CUS-08 | Add a valid number to an existing blank container after dispatch handoff. | Direct authorized update with no approval screen/request; invalid identifiers remain blocked. |
| VID-CUS-09 | Open the time and date inputs on phone/tablet/desktop; choose shortcuts and type an exact off-step minute. | Inputs open separate adaptive selectors; 24h values are retained without rounding or premature partial-input errors. |
| VID-CUS-10 | Save a blank container number on an inherited-factory import lot with explicit lift/drop ports; compare ports before and after fulfillment creation. | Both port IDs and displayed port names remain unchanged; factory delivery snapshots cannot replace Cảng hạ. |
| VID-CUS-11 | Search a padded historical Bill using its full value or final four/five characters. | Dated and undated matching records remain reachable in both overview and container lists; identifier punctuation is literal. |
| VID-CUS-12 | Concurrently create six unique Bills with one declaration, or six identical Bills/Bookings. | One request succeeds; other requests return structured 409 conflicts including the original creator and shipment link. No orphan intake records persist. |
| VID-CUS-13 | Create a shipment/declaration, edit the declaration in another session, then replay the original create request. | Replay returns the initial declaration ID from the original transaction, without asking the client to create another declaration. |
| VID-CUS-14 | Type a complete native date when the browser sends input before change; press Enter, or blur with a complete pending value. Also edit time while leaving date segments incomplete. | Complete date reaches the form before save; input/change/blur emit only one update. Incomplete native date segments block Enter and Save instead of reusing the previous valid date. |
| VID-CUS-15 | Open an LCL schedule quick-edit modal; change time and leave a native date invalid; press its footer Save. | Footer submits through the existing form validity boundary and cannot bypass invalid date fields. A corrected complete date saves normally. |

Automated service/component runs are recorded separately from actual browser-driven verification. Physical-device software keyboards and production deployment are outside local execution evidence.
