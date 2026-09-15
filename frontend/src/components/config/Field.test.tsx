import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { Field } from './Field';

it('associates catalogue labels with distinct inputs and preserves explicit IDs', () => {
  render(<><Field label="Biển số"><input /></Field><Field label="Mô tả"><input /></Field><Field label="Mã"><input id="explicit-code" /></Field></>);
  const plate = screen.getByLabelText('Biển số');
  const description = screen.getByLabelText('Mô tả');
  expect(plate.id).not.toBe('');
  expect(plate.id).not.toBe(description.id);
  expect(screen.getByLabelText('Mã')).toHaveAttribute('id', 'explicit-code');
});
