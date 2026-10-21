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

  // Card 081026230540: the modal Gọi buttons share the #364 whitespace
  // contract — inner spaces never reach the tel: URI.
  it('card 081026230540: the Gọi href strips inner whitespace from the stored number', () => {
    render(<OperationalSiteContactsList callable contacts={[
      { name: 'Kho chính', phone: '0989 130 345', isDefault: true },
    ]} />);

    expect(within(screen.getAllByRole('listitem')[0]).getByRole('link', {
      name: 'Gọi Kho chính 0989 130 345',
    })).toHaveAttribute('href', 'tel:0989130345');
  });

  // REQ-14: on the callable (driver) surface the displayed number itself is a
  // tap-to-call link — the stored text keeps its dots on screen while the
  // href is normalized (spaces/dots stripped, +84 kept).
  it('REQ-14: the displayed number is itself a tel: link with a normalized href', () => {
    render(<OperationalSiteContactsList callable contacts={[
      { name: 'Liên hệ nhà máy', phone: '+84.28.3822.1234', isDefault: false },
    ]} />);

    const row = screen.getAllByRole('listitem')[0];
    const numberLink = within(row).getByRole('link', { name: '+84.28.3822.1234' });
    expect(numberLink).toHaveAttribute('href', 'tel:+842838221234');
    expect(numberLink).toHaveClass('site-contact-list__phone');
  });

  it('REQ-14: read-only (config) surface keeps the number plain text — no dead link', () => {
    render(<OperationalSiteContactsList contacts={[
      { name: 'Liên hệ nhà máy', phone: '02838221234', isDefault: false },
    ]} />);

    expect(screen.getByText('02838221234', { exact: true }).closest('a')).toBeNull();
    expect(screen.queryByRole('link', { name: /Gọi / })).toBeNull();
  });
});
