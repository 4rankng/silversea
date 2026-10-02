# Routes and driver follow-up visual QA

Only manual browser checks. Source review does not count as a browser pass.

| Case | Steps | Expected |
|---|---|---|
| ROUTE-VIS-001 | `/config/routes` at 390px, 820px, 1440px; inspect sparse and fully populated routes, open row menu and edit. | Route name leads a compact flat record; empty optional fields do not consume phone/tablet rows. Populated facts remain readable and edit exposes all fields. Neutral hover; no clipping or horizontal overflow. |
| ROUTE-VIS-002 | Open route add/edit on phone. | Code and distance share one row; route names and location retain enough writing space. |
| DRV-VIS-010 | Trigger occupied-truck error on one order, follow its running-trip link, then navigate between details. | Prior trip's error, image preview, pending edit and collapse state do not carry across trip IDs. Dates consistently show four-digit years. |
| DRV-VIS-011 | Clear an existing required container number and save; then enter an invalid number; finally restore a valid number. | Blank/invalid values show useful validation and retain the editor; no false-success toast. |
| DRV-VIS-012 | Completed trip detail and POD page; inspect uploaded image/PDF and history. | Completed wording offers viewing documents, not repeat completion; upload actions obey actual backend edit permissions. PDFs are reachable. No customer-approval claim or technical version strings. |
| DRV-VIS-013 | POD at 390px: upload evidence and inspect actions and progress. | Capture/upload sit beside one another with comfortable touch targets; progress and status are concise. |
| DRV-VIS-014 | Journey history: switch selected month, then check active tabs; repeat at 1440px. | History follows month while new/running orders remain reachable. Desktop uses two columns without splitting linked groups. |
| DRV-VIS-015 | Scroll a trip detail to the footer, open its POD page, then use Back and navigate to another trip. Repeat with cached data. | Each opened driver detail/POD screen starts at its header; same-screen evidence refresh preserves the current position. |
| SHELL-VIS-001 | At 390px, scroll CUS shipment creation down and open/focus date and time selectors; repeat driver detail→POD navigation. | Topbar stays at viewport top. Root/app/main never acquire scroll offsets; the content scrollport and picker list retain normal scrolling. |

Status: pending controller browser verification.
