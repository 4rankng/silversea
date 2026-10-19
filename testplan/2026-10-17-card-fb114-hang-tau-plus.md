# Case: FB-114 — /shipments/new, nút '+' Hãng tàu khó bấm + tên hãng vừa nhập không lưu lại

- Case ID: 2026-10-17-card-fb114-append-hit-target; 2026-10-17-card-fb114-shipping-line-honest-label
- Reported: FB-114 (silversea) — "Màn hình tạo mới lô hàng, Dấu '+' để thêm
  Hãng tàu đang bị khó bấm, sau khi thêm mới Hãng tàu không lưu lại data hãng
  tàu đã thêm"
- Status: FIXED (17/10/2026); bug 2 re-opened by verify-fail below

## Case: FB-114 verify-fail — hãng tàu mới phải lưu vào danh mục chung trên server

- Case ID: 2026-10-17-card-fb114-shipping-line-server-persist
- Reported: ticket 171026185348 (verify-fail of 171026122150): "hãng tàu mới
  phải được lưu vào danh mục chung trên server (không chỉ local form)"
- Status: FIXED (17/10/2026)

## Reproduction

1. Log in as any role that can open `/shipments/new` (CUS / DISPATCHER /
   MANAGER / ADMIN), open `/shipments/new` (FCL).
2. Click the Pencil "Đặt tên hãng tàu cho lô này", type a brand-new name
   (e.g. "Ocean Network Express"), click "Áp dụng".
3. Reload the page (F5) and open the Hãng tàu dropdown.

Observed (pre-fix): the name is gone from the dropdown. `applyShippingLine`
wrote only `form.shippingLineName` + a session-local `setCatalogs` merge;
backend `shippingLines` derives from `DEFAULT_SHIPPING_LINES` + ACTIVE
suppliers typed SHIPPING_LINE (`backend/src/services/config.service.ts`), and
no supplier row was ever created — the name evaporated on reload for EVERY
user, not just the one who typed it.

Expected (post-fix):
1. The dialog apply creates a server-side SHIPPING_LINE supplier record
   (shared catalog — "danh mục chung"), idempotent on the display name.
2. After reload the Hãng tàu dropdown lists the new name for every user.
3. The typed name still rides `form.shippingLineName` for THIS lot (unchanged
   free-text contract).
4. Validation: trimmed, non-empty, ≤ 255 chars; duplicate display name (incl.
   DEFAULT_SHIPPING_LINES and non-shipping-line suppliers) never creates a
   second row.
5. Failure to persist (network/validation/conflict) keeps the dialog open with
   an accessible error and does NOT claim success.

## Root cause + fix

- Old option (B) "make it honest" (17/10 morning) only relabelled the action;
  the verify-fail correctly demands option (A) persistence. The two are now
  combined: the name is for this lot AND becomes a shared catalog entry.
- BE: `POST /api/shipments/shipping-lines` (shipments mount → casbin
  `shipments:write`, `requireRoles(SHIPMENT_INTAKE_MUTATION_ROLES)`,
  non-material write) creates a supplier with `types ['SHIPPING_LINE']`,
  busts the `catalogs:bootstrap` cache, returns 201 `{ id, name, created }`;
  an existing name (default or supplier display name, case-insensitive)
  returns 200 idempotent; a name colliding with a non-shipping-line or
  inactive supplier returns 409.
- FE: `applyShippingLine` calls the endpoint FIRST, then sets
  `form.shippingLineName` and merges the name into the local catalog, then
  closes the dialog. Errors surface inside the dialog (stays open).
- Field hint copy updated to scope the catalog add to the pencil:
  "Danh mục hãng tàu lấy từ Nhà cung cấp loại 'Hãng tàu'. Tên nhập tay lưu
  cùng lô hàng này; dùng nút bút chì để thêm vào danh mục chung." (the old
  "chỉ lưu cùng lô hàng này" became false; a direct-typed name still rides
  the lot only, so the hint must not claim a catalog add for it). Dialog
  title/body kept per ticket (still true).

## Pins + evidence

- `backend/src/tests/shipping-line-intake-catalog.test.ts` — HTTP through the
  real mount: create → 201 + bootstrap lists it + supplier row typed
  SHIPPING_LINE; duplicate/case/whitespace → 200 one row; default name → 200
  no row; empty / >255 → 400; non-shipping-line collision → 409; role matrix
  403 (OPS) + 401 (no token).
- FE: `ShipmentCreateWorkspace.shipping-line-persist.test.tsx` — dialog apply
  → API called first, catalog updated, field holds the name; API failure →
  dialog stays open with error, no fake success.
- See `qa/2026-10-17_fb114-persist_*` artifacts.

## Reproduction

1. Hit target: on `/shipments/new` (FCL), the trailing '+' on both the
   Khách hàng and Hãng tàu fields is `.csc-append-button` —
   `position: absolute; top: 26px; right: 5px; z-index: 1; width: 26px;
   height: 26px` (ClerkShipmentCreatePage.css:87). Below the 32px touch
   floor, and the overlay sits on the input's right edge (the input reserves
   `padding-right: 28px` for it) with z-index 1 — clicks near the edge land
   on the input, not the button. Mouse slips; touch misses.
2. Persistence: the 'Thêm hãng tàu' dialog applies via
   `applyShippingLine` (ShipmentCreateWorkspace.tsx:305) which mutates only
   local React state (`setCatalogs`). Backend `shippingLines` is a DERIVED
   list — `DEFAULT_SHIPPING_LINES` + suppliers with type SHIPPING_LINE
   (backend/src/services/config.service.ts:108); no table, no POST endpoint.
   The new name vanishes from the dropdown on reload.

Expected (bug 1): every visible control is comfortably clickable — hit
target ≥ 32px, no overlay race with the input.
Expected (bug 2): the UI must not promise catalog persistence the backend
does not have.

## Root cause + fix

- Bug 1: the append action moved OUT of the field's box — it is now a flex
  sibling inside `.csc-field-with-append` (already `display: flex;
  gap: 8px`), 36×36px (≥ 32px floor, ≤ 40px ordinary-control ceiling),
  `margin-top: 26px` keeps it on the control row (18px label + 8px gap),
  explicit `:active` press state. The `padding-right: 28px` input
  reservation and the `position: absolute`/`z-index` overlay are retired —
  no hit-target-vs-input race, no overlap with the combobox's own clear
  affordance. Owner ruling 11/10 ("plus at the end of the search bar") is
  superseded for this control by FB-114: the icon still trails the field,
  but in its own box.
- Bug 2 — decision locked to option (B) "make it honest" (a real catalog is
  a bigger product decision than this ticket; option A rejected):
  - Button label/title/aria: "Thêm hãng tàu" → "Đặt tên hãng tàu cho lô
    này"; icon Plus → Pencil (it names the field, it does not add to a
    catalog).
  - Dialog title likewise; the honest copy "Tên hãng tàu sẽ được lưu cùng
    lô hàng hiện tại." is kept.
  - Hint under the Hãng tàu field: "Danh mục hãng tàu lấy từ Nhà cung cấp
    loại 'Hãng tàu'. Tên nhập ở đây chỉ lưu cùng lô hàng này."
  - `applyShippingLine` drops the session-local `setCatalogs` append — the
    dropdown stays the server catalog; the typed name rides
    `form.shippingLineName` (free-text contract, `allowsCustomValue` shows
    it in the input).

## Pins + evidence

- New contract: `frontend/src/features/shipments/create/ShipmentCreateAppendAction.test.tsx`
  — stylesheet pins (36px hit target, flex sibling, no absolute overlay, no
  input padding reservation), clickability (dialog opens), honest names,
  apply → `shippingLineName` holds the trimmed value, hint rendered.
- Updated: `ClerkShipmentCreatePage.styles.test.ts` (geometry pin),
  `ClerkShipmentCreatePage.test.tsx` (names), see qa/ artifacts.
- Backend untouched: `pnpm -C backend exec tsc --noEmit` still green
  (no backend change; run for the record per gate table).
