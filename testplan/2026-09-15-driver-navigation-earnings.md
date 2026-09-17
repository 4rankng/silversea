# Driver navigation and earnings follow-up

Scope: local Chrome checks only, as requested. No automated suites, build, lint or typecheck. Browser execution is owned by the main audit; these cases are pending until evidence is recorded there.

## DRIVER-NAV-01 — Return from e-POD to the same trip

1. As lái xe, open an assigned, in-transit trip whose trip ID differs from its fulfillment ID (for example, trip 4188 / fulfillment 4948 if still in the relevant state).
2. Open e-POD, then click the page back button. Repeat with Escape.
3. Open the e-POD URL directly and repeat after loading.

Expected: the detail URL uses the actual trip ID, and the same trip/container remains visible. Invalid or unavailable task links return safely to the journey list.

## DRIVER-NAV-02 — Two Orders opens the selected trip

1. As lái xe, open `/my-trips/two-orders` with an active/next order or persisted pair.
2. Click each visible order card, including an ad-hoc trip without a fulfillment when available.

Expected: `/my-trips/<trip ID>` opens the selected trip; a missing fulfillment never substitutes another ID or silently sends the driver to the list.

## DRIVER-EARN-01 — Financial counters retain units and signs

1. Open `/my-earnings` for a period with earnings and a positive disciplinary deduction.
2. Observe initial render, animated values, and their settled state.

Expected: supporting amounts keep the `đ` suffix throughout. A positive deduction is displayed as a negative amount throughout. Hero and remaining-balance summary stay in agreement.

## DRIVER-EARN-02 — Payslip period and topbar stay aligned

1. Select one month in the topbar. Open a different issued period from the Bảng lương page.
2. Confirm the earnings summary and topbar show that payslip's month/year.
3. Reload the earnings URL, then change the topbar month and use browser back/forward between earnings links.
4. Open `/my-earnings?month=13&year=invalid`.

Expected: valid deep links retain their requested period through reload; topbar selection updates the URL and displayed earnings. Back/forward restores its period. Invalid or incomplete parameters fall back to the current valid topbar period, without invalid requests.
