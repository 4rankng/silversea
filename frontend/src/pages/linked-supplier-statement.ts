export function matchLinkedSupplierStatement<T extends { supplier: { id: number } }>(
  statement: T | undefined,
  linkedSupplierId: number | null,
): T | undefined {
  return statement?.supplier.id === linkedSupplierId ? statement : undefined;
}
