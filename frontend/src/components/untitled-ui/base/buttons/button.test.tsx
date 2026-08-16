import { render, screen } from '@testing-library/react';
import { RotateCcw } from 'lucide-react';
import { describe, expect, it } from 'vitest';

import { Button } from './button';

describe('Button', () => {
  it('applies the icon sizing contract to a rendered leading icon', () => {
    render(<Button iconLeading={<RotateCcw aria-hidden="true" />}>Xóa bộ lọc</Button>);

    const icon = screen.getByRole('button', { name: 'Xóa bộ lọc' }).querySelector('svg');
    expect(icon).toHaveAttribute('data-icon', 'leading');
    expect(icon).toHaveClass('size-5');
  });
});
