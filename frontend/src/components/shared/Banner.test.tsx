import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen } from '@testing-library/react';
import { AlertTriangle } from 'lucide-react';
import { describe, expect, it } from 'vitest';
import { Banner } from './Banner';

const bannerCss = readFileSync(
  resolve(process.cwd(), 'src/components/shared/Banner.css'),
  'utf8',
);

describe('Banner', () => {
  it('keeps the action and dismiss control in explicit compact mobile areas', () => {
    expect(bannerCss).toMatch(
      /@media \(max-width: 640px\)[\s\S]*?grid-template-areas:\s*"content close"\s*"action action";/,
    );
    expect(bannerCss).toMatch(
      /@media \(max-width: 640px\)[\s\S]*?\.nepo-banner__close\s*\{[\s\S]*?min-width:\s*44px;[\s\S]*?min-height:\s*44px;/,
    );
  });

  it('uses semantic soft status surfaces instead of saturated full-fill colors', () => {
    expect(bannerCss).toMatch(
      /\.nepo-banner--warning\s*\{[\s\S]*?background:\s*var\(--warning-soft\);[\s\S]*?color:\s*var\(--warning-text\);/,
    );
    expect(bannerCss).toMatch(
      /\.nepo-banner--danger\s*\{[\s\S]*?background:\s*var\(--danger-soft\);[\s\S]*?color:\s*var\(--danger-text\);/,
    );
  });

  it('renders and dismisses an actionable status notice', () => {
    render(
      <Banner
        variant="danger"
        icon={AlertTriangle}
        action={<button type="button">Xem công nợ</button>}
      >
        10 khách hàng đang quá hạn trên 90 ngày.
      </Banner>,
    );

    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Xem công nợ' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Đóng thông báo' }));

    expect(screen.queryByRole('status')).toBeNull();
  });
});
