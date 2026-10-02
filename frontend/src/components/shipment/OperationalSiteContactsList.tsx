import type { OperationalSiteContact } from '@tingting/shared';
import { Button } from '../untitled-ui/base/buttons/button';
import './OperationalSiteContactsList.css';

/** Named contact data stays plain; only the explicit telephone action is a button. */
export function OperationalSiteContactsList({ contacts, callable = false }: {
  contacts: OperationalSiteContact[];
  callable?: boolean;
}) {
  return <ul className="site-contact-list">
    {contacts.map(contact => <li key={contact.phone} className="site-contact-list__row">
      <div className="site-contact-list__identity">
        <span>{contact.name}</span>
        <span className="site-contact-list__phone">{contact.phone}</span>
        {contact.isDefault && contacts.length > 1 ? <span className="site-contact-list__default">Mặc định</span> : null}
      </div>
      {callable ? <Button href={`tel:${contact.phone}`} color="secondary" size="sm" aria-label={`Gọi ${contact.name} ${contact.phone}`}>Gọi</Button> : null}
    </li>)}
  </ul>;
}
