import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { TextArea } from './textarea';

describe('TextArea', () => {
  it('uses the shared compact field typography for sm textareas and labels', () => {
    const { container } = render(<TextArea label="Ghi chú" size="sm" />);

    expect(container.firstElementChild).toHaveAttribute('data-input-size', 'sm');
    expect(screen.getByLabelText('Ghi chú')).toHaveClass('text-[length:var(--text-control-compact-size)]', 'max-md:text-[length:var(--control-zoom-safe-font-size)]', '[@media(pointer:coarse)]:text-[length:var(--control-zoom-safe-font-size)]');
  });
});
