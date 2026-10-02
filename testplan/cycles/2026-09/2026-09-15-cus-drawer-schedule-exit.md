# CUS drawer scheduling and list refresh

| Case | Reproduction | Expected |
| --- | --- | --- |
| VID-CUS-DRAWER-01 | Open an undated shipment from the overview. Type a complete appointment, press Enter, and let the refreshed list move that shipment off the current page/filter. | The saved appointment persists and the drawer closes to the overview. No empty drawer, false saving warning, or stale navigation guard remains. |
| VID-CUS-DRAWER-02 | Edit a container plate in the overview drawer and press Enter while the refreshed list no longer contains the shipment. | Preserve the existing generic Enter save-and-exit behavior: the plate saves once, the drawer closes, and no stale busy guard remains. |

Real reproduction: local CUS shipment9410/container6041, VID-NEW-73835905; entered15:17 24/09/2026. The pre-fix screenshot/DOM is qa/2026-09-15_customer-video/cus-undated-supplement-empty-drawer.*, and DB proof cus-undated-supplement-readback.json records2026-09-24T08:17:00Z. Appointment persistence succeeds; the failure is drawer ownership during refreshed list reordering.
