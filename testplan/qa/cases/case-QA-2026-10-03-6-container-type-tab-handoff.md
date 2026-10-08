# Case QA-2026-10-03-6 — Tab hand-off opens the Loại container picker (card 20261002_272)

- **Case ID:** QA-2026-10-03-6
- **Reported:** 2026-10-02 (A04) + TingTing chat 03/10 (customer verbatim on card); PM priority.
- **Ruling:** lead approved option (a) — precise Tab hand-off; the 09-21 focus-trigger rejection is scoped, not reversed.
- **Surface:** /shipments/new Tạo lô hàng — a container row's Số container field → Loại container picker.
- **Mutation surface:** none for the assertion itself (typed text is never saved; the tab is closed without Lưu).
- **Status:** case PREPARED — fix landed (see card for sha); UI DRIVEN local rung on the card; staging rung owed at wave cut.

## Steps

1. Login CUS (thanhdc) → /shipments/new, first container row.
2. Click into Số container, type a container number (e.g. TESTU1234567).
3. Press Tab: focus lands on the Loại container input AND its suggestion menu
   opens immediately (exactly once) — no mouse.
4. Typing filters the options; ArrowDown + Enter picks; Escape closes.
5. Tabbing across the Loại container cell from OTHER fields (pass-through)
   does NOT open the menu; bare focus alone does not either (jsdom pin).

## Expected

- Full keyboard flow number → Tab → menu → pick without any mouse use;
  pass-through and bare focus stay closed (09-21 ruling preserved).

## Local rung (2026-10-03)

- Tab from Số container: menu opened, focus on "Loại container".
- Typing "4" filtered to 21 options; Escape closed.
- Bare-focus-closed pin: ContainerTypeCellPicker.test (jsdom).
