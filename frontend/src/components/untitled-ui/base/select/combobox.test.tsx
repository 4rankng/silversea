import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ComboBox } from './combobox';
import { SelectItem } from './select-item';

describe('ComboBox', () => {
  it('propagates the compact size contract to its label', () => {
    render(
      <ComboBox label="Khách hàng" size="sm" items={[{ id: '1', label: 'Khách hàng A' }]}>
        {(item) => <SelectItem id={item.id} label={item.label} />}
      </ComboBox>,
    );

    expect(screen.getByText('Khách hàng').closest('[data-input-size="sm"]')).toBeTruthy();
  });
});
