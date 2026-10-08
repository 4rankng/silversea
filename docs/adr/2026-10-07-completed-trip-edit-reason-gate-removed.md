---
date: 2026-10-07
status: accepted
deciders: Frank Nguyen
source: Explicit owner instruction 07/10/2026 09:37 ("I ask other agent to remove the reason requirement, no one need to write reason"), board card 20261007_394
scope: Editing figures of a COMPLETED trip (/trips/:id/edit)
---

# The completed-trip edit no longer demands an adjustment reason

Editing a COMPLETED trip's figures (/trips/:id/edit → 'Lưu cập nhật' → the
revenue 'Áp dụng' confirm) previously required a typed 'Lý do điều chỉnh'
(frontend guard in the submit hook + a required textarea). The owner removed
that gate on 07/10/2026: nobody needs to write a reason for these
corrections. The save flows straight through the existing revenue
confirmation; a reason supplied programmatically is still audited (the
actuals endpoint treats it as optional audit metadata since card 393), and
the frontend no longer renders the reason box at all.

This SUPERSEDES any earlier ruling or copy that demanded a typed reason for
completed-trip figure edits (the textarea copy itself and its guard pins are
removed with this decision). UNTOUCHED, deliberately: the completion-date
guard (card 061026221826 — completedAt never precedes departure), the
governed completion close's own reason on POST /trips/:id/complete, the
expense-adjustment reason flows (ExpenseEntryPage / ExpenseEntryDrawer), and
the cost-lock adjustment reason — each governs a different action.

Landed across card 393's relaxation (backend optional reason, frontend guard
removal), MiniMax's 7db787af + 0ea3b35d reworks, and card 20261007_394's
frontend section removal.
