import type { OperationalSiteContact } from '@tingting/shared';
import { Button } from '../untitled-ui/base/buttons/button';
import { TelLink, telHref } from '../TelLink';
import './OperationalSiteContactsList.css';

/** Named contact data stays plain on read surfaces; on the callable (driver)
 * surface the number ITSELF is also a tap-to-call link (REQ-14 — "SĐT
 * kho/nhà máy chạm là mở màn hình gọi") beside the explicit Gọi button, so
 * both the number and the button share one tel: target. */
export function OperationalSiteContactsList({ contacts, callable = false }: {
  contacts: OperationalSiteContact[];
  callable?: boolean;
}) {
  return <ul className="site-contact-list">
    {contacts.map(contact => <li key={contact.phone} className="site-contact-list__row">
      <div className="site-contact-list__identity">
        <span>{contact.name}</span>
        {callable
          ? <TelLink phone={contact.phone} className="site-contact-list__phone site-contact-list__phone--tel" />
          : <span className="site-contact-list__phone">{contact.phone}</span>}
        {contact.isDefault && contacts.length > 1 ? <span className="site-contact-list__default">Mặc định</span> : null}
      </div>
      {callable ? <Button href={telHref(contact.phone)} color="secondary" size="sm" aria-label={`Gọi ${contact.name} ${contact.phone}`}>Gọi</Button> : null}
    </li>)}
  </ul>;
}
