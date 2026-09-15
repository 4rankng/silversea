import { render, screen } from '@testing-library/react';
import { RotateCcw } from 'lucide-react';
import { describe, expect, it } from 'vitest';

import { Button } from './button';

describe('Button', () => {
  it('uses compact desktop sizing and a touch-safe narrow-screen minimum for sm', () => {
    render(<Button size="sm">Tìm kiếm</Button>);

    expect(screen.getByRole('button', { name: 'Tìm kiếm' })).toHaveClass(
      'min-h-[34px]',
      'text-[length:var(--text-control-compact-size)]',
      'max-md:min-h-11',
      '*:data-icon:size-4',
    );
  });

  it('keeps regular form actions at the default density', () => {
    render(<Button size="md">Lưu</Button>);

    expect(screen.getByRole('button', { name: 'Lưu' })).toHaveClass('min-h-10', 'text-sm', 'max-md:min-h-11');
  });

  it('applies the icon sizing contract to a rendered leading icon', () => {
    render(<Button iconLeading={<RotateCcw aria-hidden="true" />}>Xóa bộ lọc</Button>);

    const icon = screen.getByRole('button', { name: 'Xóa bộ lọc' }).querySelector('svg');
    expect(icon).toHaveAttribute('data-icon', 'leading');
    expect(icon).toHaveClass('size-5');
  });
});
