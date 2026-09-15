# Responsive shell and account interaction

Scope: authenticated navigation and driver account sheet. Existing roles, routes, account changes, and sign-out behavior remain unchanged. The interface requires internet access and has no internal approval workflow.

## SHELL-POLISH-001 — Compact account sheet

1. Sign in as a driver at 360×800, 390×844, 768×1024 and 844×390.
2. Open **Tài khoản** from the bottom navigation.
3. Inspect a long name, username and phone, then scroll the sheet if needed.

Expected: a single flat identity section followed by separated action rows, without nested decorative cards. Text wraps rather than widening the screen. Close, profile, password and sign-out targets are at least 44px tall. All actions remain reachable in a short landscape viewport. The sheet respects safe-area edges and does not scroll the page behind it.

## SHELL-POLISH-002 — Keyboard and immediate actions

1. Focus **Tài khoản** and activate it with the keyboard.
2. Tab and Shift+Tab across sheet controls; close with Escape and with the close button.
3. Reopen, immediately press profile/password/sign-out before the entrance animation ends.
4. From the account sheet, open **Thông tin cá nhân** and **Đổi mật khẩu** in turn; dismiss each with Cancel, Close or Escape.

Expected: a named modal dialog with focus contained inside it; opening places focus on Close; dismissing returns focus to the account trigger. Opening profile/password transfers focus to that dialog; closing it returns focus to the persistent **Tài khoản** bottom-navigation trigger even though the original sheet action was unmounted. Desktop dialogs keep their existing opener behavior. Immediate actions work on their first press, with no invisible or moving hit targets. The current bottom-navigation destination is announced as the current page. Account reports its expanded state.

## SHELL-POLISH-003 — Desktop boundary and restrained motion

1. Open the account sheet below 1024px; resize to 1280px.
2. Open the desktop sidebar account menu, then resize back to mobile.
3. Repeat navigation and account opening with reduced motion enabled.

Expected: only the account surface for the current viewport appears; no duplicate or unstyled sheet. Navigation labels remain visible without waiting for optional motion. Reduced-motion preference removes shell entrance and scroll animation. Compact desktop retains the narrow rail; wide desktop preserves the existing expanded-sidebar policy.

## SHELL-POLISH-004 — Navigation wording and page width

1. Open the Admin, Manager and Accountant sidebars.
2. Inspect their reports section; navigate to a report.
3. Open data-heavy pages on phone, tablet and desktop.

Expected: reports are labeled **Báo cáo**, with no approval promise. Existing report destinations and permissions remain unchanged. The content grid cannot force viewport overflow; the shell does not reserve a decorative second scrollbar gutter or any scrollbar gutter on coarse-pointer devices.

## Evidence

Automated component and style checks belong in `qa/2026-09-14_responsive-shell_tests.log`. Actual Chrome viewport interaction and screenshots are collected by the parent UI-polish task; component execution alone is not a claim of browser coverage.

## DASH-POLISH-001 — Dashboard summary wraps without colliding text

1. Open the Admin or Manager dashboard at 390px, 768px and 1440px widths.
2. Inspect the introduction with positive, negative, zero-baseline (Mới) and unavailable month-over-month comparison states; repeat with a long account name.

Expected: greeting, period, comparison and net-profit sentences remain separated and readable. The summary can shrink and wrap naturally beside desktop actions. An inline highlighted comparison must not visually run into the preceding “doanh thu” text, and no text is positioned outside normal flow. Existing report values and calculation rules remain unchanged.
