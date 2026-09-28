/**
 * Does this page print its own `<h1>`?
 *
 * The topbar's "Đang xem <page>" context block is the app's FALLBACK page title:
 * on a route that renders its own heading, keeping both puts the same words on
 * screen twice. That is not a cosmetic detail — on a phone the duplicate is what
 * pushes the topbar title onto a second line (responsive.css flips the block to
 * `white-space: normal` at ≤640px so nothing is clipped), and a two-line title
 * plus the page's own heading is the "title printed twice" report the operator
 * raised on /shipments (card 20260928_161).
 *
 * So the block is a fallback, not a decoration: a page that owns a heading says
 * so here, and the phone band drops the fallback. Desktop keeps it — there the
 * topbar is a persistent orientation cue and the two lines are not adjacent.
 *
 * **EXACT paths, not prefixes.** Every route that starts with `/shipments`
 * belongs to a different page: `/shipments/new` → `ClerkShipmentCreatePage`,
 * `/shipments-detail` → `ShipmentContainersPage`, `/shipments-debit` →
 * `ShipmentDebitPage`, `/shipments/:id` → `ShipmentDetailPage`. Those render NO
 * `<h1>`, so the topbar block is their only visible title on a phone. Listing
 * `/shipments` as a prefix here would silently strip the title off four pages.
 */
const PAGE_OWN_HEADING_PATHS = [
  // Card 20260928_161 — `/shipments` prints `<h1>Tổng quan lô hàng</h1>` in the
  // control surface (ShipmentsPage.tsx) while the topbar printed the same
  // string, twice within 40px of each other at 390px.
  '/shipments',
] as const;

export function hasPageOwnHeading(pathname: string): boolean {
  return PAGE_OWN_HEADING_PATHS.some((path) => pathname === path);
}
