# Selected dispatch task contrast

Case ID: VID-DSP-HOVER-01

1. Sign in as điều vận and open the task/note editor for a detailed plan.
2. Select HẾT HẠN and ĐẢO VỎ, leave the pointer over one selected pill, and resize to tablet width.
3. Move the pointer between selected and unselected task pills, then toggle a selected pill off and on.

Expected: every selected pill retains white text on its green background during hover. Unselected pills keep their existing green text/border hover feedback. Selection, notes, spacing, and keyboard focus behavior remain unchanged.

Reported browser evidence: qa/2026-09-15_customer-video/dispatch-editor-tablet.png. The pre-fix selected HẾT HẠN foreground matched its green background because the unqualified hover selector had greater specificity than the selected-state selector. Controller captures the after-fix hover result in the active Chrome session.
