import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { NativeSelect } from './select-native';

describe('NativeSelect', () => {
  it('uses the shared compact field contract for sm selects', () => {
    const { container } = render(
      <NativeSelect
        label="Kế hoạch"
        size="sm"
        options={[{ label: 'Tất cả trạng thái', value: '' }]}
      />,
    );

    expect(container.firstElementChild).toHaveAttribute('data-input-size', 'sm');
    expect(screen.getByLabelText('Kế hoạch')).toHaveClass(
      'min-h-[34px]',
      'text-[length:var(--text-control-compact-size)]',
      'max-md:min-h-11',
      'max-md:text-[length:var(--text-input-touch-size)]', '[@media(pointer:coarse)]:text-[length:var(--text-input-touch-size)]',
    );
  });
});
