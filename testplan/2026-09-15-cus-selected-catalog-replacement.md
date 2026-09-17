# CUS selected catalog replacement

Video source: approximately 3 seconds, customer reports difficulty clearing selected factory, route and ports before searching again.

| Case | Steps | Expected |
| --- | --- | --- |
| VID-CUS-SELECT-01 | Select an existing catalog item, select all input text, Backspace, type a replacement query, and choose its option. | Blank display clears the selected ID; query text survives controlled rerenders; selecting the replacement commits only its ID. |
| VID-CUS-SELECT-02 | On FCL creation select factory, route and both ports, clear all four, blur, and save the draft. In a second run, select replacements before saving. | Incomplete intake remains allowed: a cleared draft sends null for all four IDs, never hidden previous IDs. The replacement run sends only the four replacement IDs. |
| VID-CUS-SELECT-03 | Select a factory with a configured route, then clear/replace it with a factory without a route. | Canonical factory route remains locked while that factory is selected; after clearing or selecting a routeless factory, route search can be edited and replaced. |

Local browser alternatives belong to customer4711 and are listed in qa/2026-09-15_customer-video/cus-selector-alternates.json. Existing read-cus-video-browser.ts records all shipments/containers for that fixture customer, including shipment9410 and container6041. Component execution is separate from controller-driven Chrome evidence.
