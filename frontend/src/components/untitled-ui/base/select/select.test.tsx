import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Select } from './select';
import { SelectItem } from './select-item';

describe('Select trigger', () => {
  it('ellipsizes an overflowing placeholder instead of clipping it mid-word (SIL-541)', () => {
    // Same no-mid-word-cut law as Input/ComboBox (SIL-541 sweep): the Select
    // trigger's placeholder is a block `<p>`, so `truncate` on it renders a
    // clean ellipsis when the placeholder is longer than the trigger.
    render(
      <Select
        label="Hãng tàu"
        placeholder="Gõ chọn hoặc nhập hãng tàu"
        items={[{ id: 'askey', label: 'ASKEY' }]}
      >
        {(item) => <SelectItem id={item.id} label={item.label} />}
      </Select>,
    );

    const placeholder = document.querySelector('[data-uui-control="select"] p');
    expect(placeholder?.className).toContain('truncate');
    expect(placeholder?.className).toContain('text-placeholder');
  });
});
