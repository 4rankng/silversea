# Test Plan: Segmented DateTime Input with Auto-Advance & Popover Pickers

- **Date:** 2026-09-19
- **Scope:** Shipment creation appointment entry (`/shipments/new`), `DateTimeSegments`, `SplitDateTimeField`.
- **Case ID:** `TC-DATETIME-SEGMENTS-01`

---

## 1. Context & User Request

The user requested:
> "ở phần ngày giờ đóng trả thiết kế giúp em em nhập số khi full kí tự n tự động nhẩy sang trường còn lại ví dụ : giờ định dạng 08: 00 khi e nhập 08 thì full kí tự n tự nhẩy sang bên ô 00 để nhập tiếp page https://vantai.tingting.vip/shipments/new create new lo hang... also bên ngày cũng thế ạ có thể chọn phương án chọn ngày như bảng hoặc có thể cứ nhập tay bt"

Requirements:
1. When typing time in `HH:mm`, once `HH` reaches 2 valid digits (e.g. `08`), focus automatically advances to `mm` (`00`).
2. When typing date in `DD/MM/YYYY`, once `DD` reaches 2 digits (e.g. `19`), focus automatically advances to `MM` (`09`), then to `YYYY` (`2026`).
3. Cross-field flow: once `mm` is complete, focus seamlessly advances into `DD` of the date field.
4. Backward navigation: Backspace on an empty segment or ArrowLeft at index 0 moves focus back to the previous segment (including from `DD` to `mm`).
5. Separators: typing `:` or `/` pads single digits (e.g. typing `8` then `:` becomes `08`) and moves to the next segment.
6. Popover Pickers: Users can either type numbers manually OR click the clock/calendar icons to open the visual picker surface table/wheel.

---

## 2. Test Cases

### TC-DATETIME-SEGMENTS-01: Segmented Input & Auto-Advance
- **Preconditions:** Navigate to `/shipments/new` as `ADMIN` or `CUS`.
- **Steps:**
  1. Click the hour segment (`hh`) in the appointment column ("NGÀY GIỜ ĐÓNG TRẢ").
  2. Type `08` -> verify focus automatically moves to `mm`.
  3. Type `00` -> verify focus automatically moves across to `dd`.
  4. Type `19` -> verify focus automatically moves to `mm2`.
  5. Type `09` -> verify focus automatically moves to `yyyy`.
  6. Type `2026` -> verify complete value `08:00 19/09/2026`.
- **Expected:** Value is committed, active segment transfers automatically at each step without manual Tab or click.
- **Status:** PASS (verified via automated headless browser run + unit tests).

### TC-DATETIME-SEGMENTS-02: Modal Picker Affordance
- **Preconditions:** Container appointment row visible.
- **Steps:**
  1. Click calendar trigger button (`aria-label="Mở lịch — Ngày giờ đóng trả"`).
  2. Verify date picker table popover appears.
  3. Press Escape to close.
  4. Click clock trigger button (`aria-label="Mở bộ chọn giờ — Ngày giờ đóng trả"`).
  5. Verify time picker dialog appears.
- **Expected:** Visual pickers open directly without obstructing text typing.
- **Status:** PASS (verified via puppeteer + screenshots).

---

## 3. Automated Verification Evidence

- **Unit tests:**
  - `src/design-system/forms/DateTimeSegments.test.tsx` (13/13 PASS)
  - `src/design-system/forms/SplitDateTimeField.test.tsx` (13/13 PASS)
  - `src/features/shipments/create/ShipmentCreateWorkspace.copy-appointment.test.tsx` (6/6 PASS)
  - `src/features/shipments/create/ShipmentCreateWorkspace.mode-toggle.test.tsx` (21/21 PASS)
- **UI Driven Test (Puppeteer):**
  - Script: `qa/scripts/local-datetime-segments-20260919.mjs`
  - Driver log: `qa/2026-09-19_datetime-segments_ui-driver.log`
  - Screenshots:
    - `qa/2026-09-19_datetime-segments_ui-01-page-loaded.png`
    - `qa/2026-09-19_datetime-segments_ui-02-auto-advance-to-mm.png`
    - `qa/2026-09-19_datetime-segments_ui-03-auto-advance-to-dd.png`
    - `qa/2026-09-19_datetime-segments_ui-04-auto-advance-to-mm2.png`
    - `qa/2026-09-19_datetime-segments_ui-05-auto-advance-to-yyyy.png`
    - `qa/2026-09-19_datetime-segments_ui-06-full-datetime-typed.png`
    - `qa/2026-09-19_datetime-segments_ui-07-date-picker-surface-open.png`
    - `qa/2026-09-19_datetime-segments_ui-08-time-picker-surface-open.png`
