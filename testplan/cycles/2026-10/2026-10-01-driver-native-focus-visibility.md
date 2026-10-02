# QA-AUDIT-UI-64 — Driver native focus visibility

Environment: local frontend7175/API3002. Role: DRIVER. Existing owned trip1951, fulfillment3114, BillBLQA20-289316; no fake records or material completion.

1. At390/768/1440, open `/my-trips`; click actual Đã nhận, Lịch sử and Lệnh mới categories. Capture the final category and count exactly one topbar/page heading/day-view link and current empty-state message. Reject duplicated painted screenshots rather than substituting DOM for pixels.
2. Open `/my-trips/1951`; click the actual detail disclosure closed and open. Preserve native resulting scroll position. Capture the before-Tab active element and every real Tab step, scroll offsets/scroll owner geometry and focus events until delivery-document link receives focus.
3. Capture immediately, after animation frames and after settling, including full link rect, topbar/footer rects and hit-test ownership. Expected: entire focused link visible within the usable scroll viewport at each width; focus alone outside the viewport fails.
4. Press native Enter; expect `/my-trips/3114/pod` with owned Bill and canceled read-only document boundary. Capture DOM/screenshot, then actual Back.
5. Compare exact authenticated read API and source hashes before/after, material requests0. Controller obtains direct read-only Drizzle147-table AFTER before closing the complete UI DRIVEN claim.

Retain original tablet focus failure and phone duplicated-paint original. Diagnostic source-only theories, unavailable accept/fuel/completion and physical camera/material POD paths remain separate and unaccepted.
