# TC-1373 mobile navigation diagnosis

Date: 2026-07-29
Scope: `e2e/test_13_forwarder_portal.py` TC-1373 only

## Executive summary

TC-1373 did not fail because the mobile navigation control regressed.
The failing artifact shows the browser never reached the forwarder shell. It was still on the login page when the hamburger selector ran, so `menuControls=0` was a downstream symptom.

Safest classification: transient login-step flake in the E2E flow, not a deterministic frontend regression in mobile navigation.

## Evidence

1. Failing run artifact:
   - `qa/2026-07-29_shipment-operations_e2e.final.log` records `TC-1373: Mobile navigation — menuControls=0, noOverflow=True`.
   - `/tmp/tingting-e2e/20260729-203830-51772/TC-1373_mobile_sidebar.png` shows the mobile login page, not `/my-forwarder-trips`.
   - The screenshot includes the generic login error banner `Sai thông tin đăng nhập. Vui lòng thử lại.`

2. Why the banner is not proof of bad credentials:
   - `frontend/src/pages/LoginPage.tsx` catches any thrown login error and always renders the same message.
   - So the screenshot proves only: browser-form login did not complete successfully before TC-1373 asserted on navigation controls.

3. Navigation control exists in current source:
   - `frontend/src/components/layout/Topbar.tsx` renders the mobile toggle for non-driver roles with `aria-label={sidebarOpen ? 'Đóng menu điều hướng' : 'Mở menu điều hướng'}`.
   - TC-1373 looks for `[aria-label*="menu"]`, so the current forwarder shell should match.

4. Helper behavior is fragile:
   - `e2e/helpers.py` `login_as()` does:
     - API login
     - browser login form submit
     - wait
     - `localStorage.setItem("token", token)`
   - It does not assert successful navigation to the role home before the test continues.

5. Prior and subsequent evidence contradict a deterministic regression:
   - Previous passing run: `qa/2026-07-29_shipment-operations_e2e.rerun.log` passed TC-1373.
   - Focused reproduction: repeated mobile `login_as('forwarder')` checks landed on `/my-forwarder-trips` with menu controls present.
   - Fresh suite rerun: `python3 e2e/test_13_forwarder_portal.py` passed TC-1373 again.
   - Root follow-up states the subsequent final rerun also passed overall.

## Hypotheses tested

1. Deterministic mobile-nav regression
   - Eliminated.
   - Source still renders the toggle.
   - Prior pass, focused reproductions, and subsequent rerun all pass.

2. TC-1373 selector mismatch against current markup
   - Eliminated.
   - `Topbar` aria-label contains lowercase `menu`; focused reproductions found the selector successfully.

3. Login-step flake / auth-flow race inside E2E helper
   - Supported.
   - Failing screenshot is the login page.
   - `login_as()` does not prove arrival at `/my-forwarder-trips`.
   - Failure presents exactly as `menuControls=0` when assertion runs on the login page instead of the app shell.

## Conclusion

Root cause for the observed TC-1373 failure was not missing mobile navigation UI. The test asserted the hamburger selector on the wrong page because the forwarder login flow did not complete in that run. Given the immediate prior pass and subsequent pass, treat this as an E2E login-flow flake centered on `login_as()` / post-login readiness, not as a product-code regression in the forwarder mobile shell.

## Safest next action

1. Do not patch product navigation code for TC-1373.
2. Harden the E2E helper/test instead:
   - after `login_as('forwarder', page)`, assert URL contains `/my-forwarder-trips` or wait for a forwarder-shell sentinel before checking menu controls;
   - on failure, log `page.url` and save the login response status if available.
3. If the flake recurs, instrument the browser login request path specifically rather than the mobile nav selector.
