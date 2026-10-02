# QA-AUDIT-DRV-POD-01 — e-POD business reference

1. Log in as a DRIVER owning a fulfillment with an internal TRP code and a distinct Bill/Booking.
2. Open its real trip detail, click Hoàn tất lệnh vận chuyển, and inspect the e-POD header and required-documents panel at 390 and 1440 widths.
3. Repeat a missing or whitespace-only documentNumber through the existing component regression.
Expected: header and panel show the trimmed Bill/Booking. No TRP/SHP/internal numeric identifier is shown. Missing references say Chưa có số Bill/Booking. Document upload and completion gates remain unchanged.

Design provenance: retain the existing driver header and TripPodSubmission panel; this is content identity repair. Root consulted Untitled UI official Modal/Table/Tab references and Tailkit website fallback because catalog MCPs are unavailable. No pattern or primitive changes.
