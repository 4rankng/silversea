# Unified datetime surfaces — manual visual QA

Only browser visual/interaction checks are requested. Source inspection is not a passed browser case.

| Case | Route / interaction | Expected |
|---|---|---|
| DT-VIS-001 | CUS `/shipments`: open shipment detail and edit a container's appointment. Open time and date directly at 390px, 820px and 1440px. | The same compact, separate time/date inputs and shared clock/calendar as shipment creation; no secondary combined-picker button or duplicate date/time modal. Nested selectors stay open while selecting and do not dismiss the appointment editor. |
| DT-VIS-002 | Edit the appointment using exact typing, presets, selector choices, partial/invalid input, Enter, confirmation, Escape and outside dismissal. | Full local datetime reaches the existing draft/save contract; incomplete text stays visible and cannot be saved as a cleared/older appointment. Enter saves a valid value; selector Escape closes the selector first. Saving/error feedback remains usable. |
| DT-VIS-003 | Điều vận `/dispatch`: open a trip-pairing editor and change start/end in each trip. | All four datetime values use the same compact controls and existing 24-hour/Vietnamese date presentation. Invalid input cannot be submitted; date/time fields fit narrow sections and retain separate accessible names. |
| DT-VIS-004 | Review legacy `DateTimeField` and `BufferedUuiDateTimeInput` adapters when rendered in their existing field wrappers. | Controlled ISO values, disabled/read-only/required state, hints, errors and native input attributes remain supported while both wrappers reuse the shared picker UI. |

Status: CODE-READ ONLY until the controller records browser coverage.
