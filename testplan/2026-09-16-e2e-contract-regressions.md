# E2E contract regressions — 2026-09-16

Local frontend7175/backend3001 only. Extend the existing E2E gate without changing product behavior. Tests must fail for missing server logout, missing404 content, or an incorrect recovery destination; do not replace failures with skips.

| Case | Reproduction | Expected result |
|---|---|---|
| TC-E2E-AUTH-SESSION-01 / TC-0006 | Helper performs UI login, opens the rendered account menu and clicks Logout. | Helper retains the actual UI session token instead of replacing it with a different API session behind the mounted AuthProvider. Logout sends one POST to `/api/auth/logout`, receives200, clears the UI session and displays login inputs. |
| TC-E2E-404-ADMIN-01 / TC-0022 | Authenticated admin opens an unknown route; reads the page and clicks `Về trang chính`. | Unknown URL remains while `Không tìm thấy trang` is visible. The explicit recovery link targets `/config`; clicking it displays the admin home. |
| TC-E2E-404-OPS-01 / TC-0042 | Authenticated OPS opens an unknown route; reads the page and clicks `Về trang chính`. | Unknown URL remains while `Không tìm thấy trang` is visible. The explicit recovery link targets `/my-orders`; clicking it displays the OPS home. |

Initial failures retained in `qa/2026-09-16-expense-implementation/e2e/full.log`. A separate installed-Chromium Puppeteer run observed actual UI logout POST followed by `/login`; screenshot and DOM are `visual/e2e-logout-investigation.{png,json}`. Root cause for the test logout failure is the helper overwriting the UI-created token with an earlier API-created token. The explicit404 route is implemented by `NotFoundPage` and is intended current behavior.

Re-run results must be recorded in ignored `qa/`; no credentials or testdata export.

| Case | Reproduction | Expected result |
|---|---|---|
| TC-E2E-CUSTOMER-TOUCH-01 / TC-1520 | CUSTOMER opens portal at375/390/820px and uses each bottom navigation action. | Three links retain their component's52px minimum, exceed44px touch minimum, and navigate to the matching customer page; no horizontal page overflow. Global responsive defaults must not override explicit component link sizing. Before-fix computed min-height32px / actual35.64px captured in `e2e/customer-nav-before.json` and screenshot. |

| Case | Reproduction | Expected result |
|---|---|---|
| TC-E2E-CUS-MISSING-01 / TC-1821 | Create the suite18 shipment without appointment; set and clear dispatch filter; open the row's missing-data disclosure. | `Thiếu dữ liệu` is visible collapsed; clicking expands `Thông tin còn thiếu` containing `Lịch hẹn`. The schedule warning remains derived from the server's missing-field list, and the disclosure is collapsed again before subsequent editor-focus checks. |

| Case | Reproduction | Expected result |
|---|---|---|
| TC-E2E-DIRECT-DISPATCH-01 / TC-2022–2023 | CUS creates a uniquely tagged shipment. Dispatcher reads its exact fulfillment from the detail-plan API and issues the order. | No internal approval or handoff-resolution call. Dispatcher can issue with the current fulfillment version, timezone-qualified schedule and an active truck/trailer to the driver linked to the account exercised by the UI. Contract: `QuyTrinhO2C.md` sections 1/5 and `useDispatchDetailPlan.issueOrder`. |
| TC-E2E-DRIVER-OWN-FIXTURE-01 / TC-2033–2046 | Driver locates the created trip by its unique trip code, opens it, and accepts it. | Detail URL matches the newly created trip ID. That exact card moves to `Đã nhận`; never act on an arbitrary first card or the parent's fixture. |
| TC-E2E-EXIT-01 | Suite20 records a failed result. | Its command-line entry point returns the existing `run_suite` failure status; a red JSON result must not produce exit0. |
| TC-E2E-DRIVER-MOBILE-01 / TC-2032,2051,2053 | Inspect actual driver navigation and visible content at390px. | Five visible bottom-navigation actions, useful route/button text at least12px under the approved compact type scale, and the actual sidebar has no viewport intersection. Do not match the root `sidebar-closed` class as a sidebar;11px captions remain valid. |

For repeatability, the driver fixture schedule starts after existing scheduled active trips for its driver/truck. Existing trips are read only; no reset, cancellation, or acceptance of another fixture is permitted.

Suite20 must cancel only its own newly created trip in a `finally` cleanup after checking acceptance, including on assertion/crash paths. Otherwise a successful acceptance leaves a running trip that correctly prevents the next run from accepting another. Verify trip-to-shipment identity before cleanup; retain screenshots/results and server audit records.
