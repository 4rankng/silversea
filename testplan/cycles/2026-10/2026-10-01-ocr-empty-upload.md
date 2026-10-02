# QA-AUDIT-WF-07 — OCR empty-upload validation

With recognition quota clear, send authenticated POST /api/ocr/, /api/ocr/pump
and /api/ocr/persist-only using a fresh valid Idempotency-Key with no body/file.
Expect400 “Không có file tải lên” and no500/provider or persisted photo.
Keep existing multipart success, disabled recognition and ownership cases green.
This is an API boundary case; malformed browser upload is not a UI DRIVEN claim.
