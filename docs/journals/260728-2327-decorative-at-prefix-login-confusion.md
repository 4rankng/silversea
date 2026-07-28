# Decorative Username Prefix Caused Login Confusion

**Date**: 2026-07-28 23:27
**Component**: User list / auth display
**Status**: Resolved

## What Happened

The desktop and mobile user lists rendered usernames with a decorative `@`
prefix. The screenshots showed that users could interpret the prefix as part of
the login credential and enter it on the login screen.

## Technical Details

The root cause was two presentation-only JSX prefixes. The fix removed them
while preserving the literal username, authentication flow, API payloads, and
persisted data. A regression test covers both responsive render paths.

## What We Tried

Tracing the screenshot through the render path confirmed the issue was confined
to `UserTable`. No login normalization or backend change was necessary.

## Root Cause Analysis

The visual convention made decorative text look like credential data.

## Lessons Learned

Identity displays should match the literal value users must enter unless the
product contract explicitly defines a separate handle format.

## Next Steps

Keep the regression test in place. QA completed with typecheck green after the
shared declarations were refreshed, 413 tests passing, lint at zero errors, a
successful production build, and independent review approval.
