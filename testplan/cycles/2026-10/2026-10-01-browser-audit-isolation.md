# QA-HARNESS-02 — native audit browser isolation

Environment: local dev only, official installed Chrome, canonical accounts.

Reproduction: run the UI50/UI52 finite driver with full-document navigation and
the default browser launch; preserve the raw Vite localhost WebSocket console
error containing `Page entered Back-Forward Cache.` and its exit status.

Regression: set `QA_DISABLE_BACK_FORWARD_CACHE=1`, run the same actual controls
and unchanged strict HTTP/console gates, and record the launched browser flag,
screenshots, DOM assertions and read-only business-state parity. Every other
WebSocket or application error remains fatal. Without the environment flag,
the harness keeps its default launch behavior.

Expected: the isolated audit can navigate complete documents without cached
document restoration interrupting its dev WebSocket. This case does not assert
product back/forward cache restoration, physical devices or staging behavior.

Launcher regression: installed Puppeteer combines disabled features in one
comma-separated `--disable-features=` argument. Record the actual relevant
arguments and browser version, split only that argument into exact feature
tokens, and assert `BackForwardCache` matches the opt-in setting. Preserve the
original pre-navigation assertion failure; never filter application errors.
Setup assertion failures must still close the owned audit browser.
