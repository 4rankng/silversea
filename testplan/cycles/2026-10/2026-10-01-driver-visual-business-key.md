# QA-AUDIT-ENV-04 — driver visual suite follows Số Bill/Booking

1. Run `python3 e2e/test_20_visual_driver.py` against local dev7175/API3002, using canonical CUS, DISPATCHER and DRIVER accounts.
2. The shared fixture creates a persisted IMPORT shipment, valid container and fulfillment via current quick-intake, submit and detail-plan direct-dispatch APIs.
3. Locate exactly one new card by its unique Bill, click its footer, and require the exact created trip detail URL.
4. Click the actual enabled sticky Nhận lệnh vận chuyển control. Require the exact fixture fulfillment progress POST to succeed and its persisted journey-board row to have bucket RUNNING and the same Bill.
5. Switch to Đã nhận, require exactly one Bill card, and measure that card's typography/overflow. Release only the fixture trip after assertions.

Expected: all existing TC-3001 through TC-3099 execute with zero failures/skips; Bill selectors work when internal TRP codes are absent from the UI. No alternate ad hoc fixture, direct API acceptance, generated POD or product display change is allowed. Full E2E remains a separate controller gate.
