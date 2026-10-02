# QA-AUDIT-UI-06 — shared dialog control law

1. ADMIN opens /config/ports Thêm mới then the real first port edit at390/768/1440.
2. Inspect close/footer heights and focus tooltip. Close through actual close button; reopen and close through Escape.
3. Inspect /suppliers create and an existing drawer close; source regression sweeps PhotoViewer/CUS hints too.
Expected: mobile/coarse close/footer controls obey40px token; fine desktopclose stays compact36px. Tooltip says Đóng with no shortcut suffix; aria-label, Escape, focus trap/return preserved. No mutation occurs merely opening/closing dialogs.
Design provenance: version8 Untitled CLI returns modal and button-utility. Existing house adapter is used because it owns tested overlay mechanics; Tailkit official modal reference consulted by controller, no new pattern.
