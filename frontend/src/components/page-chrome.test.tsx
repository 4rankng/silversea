import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PageHeader } from './UI';
import { Breadcrumbs } from './shared/Breadcrumbs';

describe('minimal page chrome', () => {
  it('removes breadcrumbs while retaining semantic route headings and controls', () => {
    const onBack = vi.fn();
    const { container } = render(
      <>
        <Breadcrumbs items={[{ label: 'Tổng quan', to: '/' }, { label: 'Chi tiết' }]} />
        <PageHeader
          title="Chi tiết lô hàng"
          onBack={onBack}
          action={<button type="button">Lưu thay đổi</button>}
        />
      </>,
    );

    expect(container.querySelector('[aria-label="Breadcrumb"]')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Chi tiết lô hàng' })).toHaveClass('page-header__title-visible');
    fireEvent.click(screen.getByRole('button', { name: 'Quay lại' }));
    expect(onBack).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Lưu thay đổi' })).toBeTruthy();
  });

  it('shows a compact title even without actions or a back button', () => {
    render(<PageHeader title="Thông tin công ty" />);
    expect(screen.getByRole('heading', { name: 'Thông tin công ty' })).toHaveClass('page-header__title-visible');
  });

  it('shows the canonical route title in the application top bar', () => {
    const topbar = readFileSync(resolve(process.cwd(), 'src/components/layout/Topbar.tsx'), 'utf8');
    expect(topbar).toContain('topbar__context');
    expect(topbar).toContain('aria-label="Trang hiện tại"');
    expect(topbar).toContain('title={pageTitle}');
  });

  it('keeps mobile back controls at their button size', () => {
    const responsiveCss = readFileSync(resolve(process.cwd(), 'src/styles/responsive.css'), 'utf8');
    expect(responsiveCss).toContain('.page-header .btn:not(.btn--icon)');
  });
});
