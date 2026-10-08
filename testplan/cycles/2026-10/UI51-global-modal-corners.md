# QA-AUDIT-UI-51 — global rounded modal containment

Environment:local dev. Viewports390×900,768×900,1440×900.

1. Open real Thêm cảng/bãi through the actual page control. Capture settled and early rendered header corners; inspect both top edges and bottom edges against the modal shell rectangle/radius.
2. Open another polished house entity dialog and a plain shared house dialog. Verify one shell rounding boundary, header/footer paint containment, complete labels/actions and40px single-line controls.
3. Within a real entity dialog open its actual dropdown/calendar. Its portalled options remain visible and reachable; one Escape closes the picker before the dialog. Close/Cancel returns focus and preserves saved data.
4. Inspect actual custom/bare surfaces in the overlay inventory; repair their shared owner if the same corner class reproduces. Do not treat positioned popovers/media as house dialog chrome.
5. Save screenshot/DOM/driver and selected business ORM before/after proof; no material write expected.

Expected: no white square protrusion or doubled surface edge at rounded corners. The modal owns clipping of its own chrome, while portalled menus remain outside it. No blanket overflow clipping of the application or its data.

Initial evidence: user screenshot plus CODE-READ ONLY polished overflow override. Actual current local reproduction and final re-run pending.

Independent review continuation: the house Tooltip uses local CSS pseudo-elements,
not a portal. Check the actual close hint on hover and keyboard focus at every
width; its full painted rectangle must remain inside the shared shell. Check
the existing plain deposit-tracker add dialog as well as polished port/category
and password dialogs. Keep the real portalled select keyboard/Cancel path.
