/**
 * Port-edit change summary — the ONE owner of "which port field changed, in
 * business words" (SIL-1205).
 *
 * Invariant: a driver-facing notification names the field that actually
 * changed, in the business word the driver knows ("tên", "mã") — never a
 * schema key. The raw column key used to ship inside the parentheses and the
 * lái xe read the template key ("vừa thay đổi (name)") instead of the change.
 *
 * Pure and DB-free on purpose: the copy rule is pinned by a unit test, so it
 * is verified without a database and without the route stack.
 */

/** The port columns a port edit may announce, and the business label each one
 *  carries in the notification body. */
export const PORT_CHANGE_FIELD_LABELS = {
  name: 'tên',
  code: 'mã',
  address: 'địa chỉ',
  shortName: 'tên viết tắt',
  dispatchZone: 'khu vực điều phối',
  isActive: 'trạng thái',
} as const;

export type PortChangeField = keyof typeof PORT_CHANGE_FIELD_LABELS;

/** The watched columns, in the order they are announced. */
export const PORT_CHANGE_FIELDS = Object.keys(PORT_CHANGE_FIELD_LABELS) as PortChangeField[];

/** The port columns whose change a driver/Ops notification announces. */
export function portChangedFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): PortChangeField[] {
  return PORT_CHANGE_FIELDS.filter(
    (field) => JSON.stringify(before[field] ?? null) !== JSON.stringify(after[field] ?? null),
  );
}

/** The changed fields in business words — "tên", "tên và mã", "tên, mã và
 *  địa chỉ" (a Vietnamese list, not a comma dump). */
export function portChangeSummary(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): string {
  const labels = portChangedFields(before, after).map((field) => PORT_CHANGE_FIELD_LABELS[field]);
  if (labels.length === 0) return '';
  if (labels.length === 1) return labels[0];
  return `${labels.slice(0, -1).join(', ')} và ${labels[labels.length - 1]}`;
}

/** The opening sentence of the port-change notification: the port's real name
 *  and the field that changed — the field's business name, never its key. */
export function portChangeNotice(portLabel: string, changeSummary: string): string {
  return `${portLabel} vừa thay đổi ${changeSummary}.`;
}
