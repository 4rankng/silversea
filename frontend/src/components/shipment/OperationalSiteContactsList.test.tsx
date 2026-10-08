import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { OperationalSiteContactsList } from './OperationalSiteContactsList';

describe('OperationalSiteContactsList', () => {
  it('keeps the maximum-length phone separate from the default label and preserves its call target', () => {
    const phone = '+12345678901234567890123456789';
    expect(phone).toHaveLength(30);
    render(<OperationalSiteContactsList callable contacts={[
      { name: 'Liên hệ nhà máy', phone, isDefault: true },
      { name: 'Bảo vệ', phone: '0900000000', isDefault: false },
    ]} />);

    const phoneText = screen.getByText(phone, { exact: true });
    expect(phoneText).not.toContainElement(screen.getByText('Mặc định'));
    expect(within(screen.getAllByRole('listitem')[0]).getByRole('link', {
      name: `Gọi Liên hệ nhà máy ${phone}`,
    })).toHaveAttribute('href', `tel:${phone}`);

    // jsdom does not calculate flex geometry: protect the shrink/wrap rules that
    // keep this valid boundary value visible beside the telephone action.
    const css = readFileSync(resolve(__dirname, 'OperationalSiteContactsList.css'), 'utf8');
    const phoneRule = css.match(/\.site-contact-list__phone\s*\{([^}]*)\}/)?.[1];
    expect(phoneRule).toContain('min-width: 0');
    expect(phoneRule).toContain('max-width: 100%');
    expect(phoneRule).toContain('overflow-wrap: anywhere');
    expect(phoneRule).not.toContain('white-space: nowrap');
  });
});
