import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Input } from './input';

describe('Input', () => {
  it('reserves space for its invalid-state icon', () => {
    render(<Input aria-label="Số container" isInvalid placeholder="0" />);

    expect(screen.getByLabelText('Số container')).toHaveClass('!pr-9');
  });
});
