export interface OperationalSiteContact {
  name: string;
  phone: string;
  isDefault: boolean;
}

/** Legacy sites retain their current telephone until a contact list is saved. */
export function operationalSiteContacts(site: { contacts?: OperationalSiteContact[] | null; contactName?: string | null; contactPhone?: string | null }): OperationalSiteContact[] {
  if (site.contacts?.length) return [...site.contacts].sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
  const phone = site.contactPhone?.trim();
  return phone ? [{ name: site.contactName?.trim() || 'Liên hệ nhà máy', phone, isDefault: true }] : [];
}
