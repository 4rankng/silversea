# QA-AUDIT-UI-28 — specialist page navigation context

Navigate to quotations and existing office settlement detail at390/768/1440.
Expected topbar/document context: Báo giá; Chi tiết phiếu thanh toán respectively.
Actual role guard, settlement identity and body content remain intact. Verify
specific route precedence through unit regressions and actual navigation clicks;
capture screenshot/DOM and equal200 response snapshots. Sweep manifest title
fallbacks to distinguish deliberate404/brand destinations from active page gaps.

Dispatch continuation: navigate through the real menu to /dispatch-detail as
DISPATCHER. At390/768/1440 the shared current-page context must show the route's
title. At390 the page's accessible H1 may remain visually hidden; the topbar
title must be visible. No route may suppress the shared title through an old
hideContext exception. Capture actual DOM/pixels and unchanged API reads.
