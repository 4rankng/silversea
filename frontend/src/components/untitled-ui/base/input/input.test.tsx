import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Input } from './input';

describe('Input', () => {
  it('uses the shared compact field contract for sm inputs', () => {
    render(<Input aria-label="Tìm kiếm" size="sm" />);

    const input = screen.getByLabelText('Tìm kiếm');
    expect(input).toHaveClass('min-h-[32px]', 'text-[length:var(--text-control-compact-size)]', 'max-md:min-h-[42px]', 'max-md:text-[length:var(--text-input-touch-size)]', '[@media(pointer:coarse)]:text-[length:var(--text-input-touch-size)]');
    expect(input.parentElement).toHaveClass('min-h-[34px]', 'max-md:min-h-11');
  });

  it('reserves space for its invalid-state icon', () => {
    render(<Input aria-label="Số container" isInvalid placeholder="0" />);

    expect(screen.getByLabelText('Số container')).toHaveClass('!pr-9');
  });
});
