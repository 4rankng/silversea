import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ActionBar reads the whole form through context and the upload state from
// the photos hook — pin both so the bar's readiness logic is testable in
// isolation.
const formState = {
  requiredFieldsFilled: 7,
  totalRequiredFields: 7,
  legsValid: true,
  submitting: false,
  uploading: {},
};

vi.mock('../../hooks/useTripFormContext', () => ({
  useTripFormContext: () => formState,
}));

vi.mock('../../hooks/useTripFormPhotos', () => ({
  isAnyUploading: () => false,
}));

import { ActionBar } from './ActionBar';

// The bar must agree with the submit-time validation (QA-030 AC4): the
// create button never reads "Sẵn sàng tạo lệnh" while a partially-filled
// leg would fail the create — leg validity gates the same rule.
describe('ActionBar create readiness', () => {
  beforeEach(() => {
    // ActionBar publishes its responsive height via ResizeObserver, which
    // jsdom does not provide.
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      unobserve() {}
      disconnect() {}
    });
    formState.requiredFieldsFilled = 7;
    formState.legsValid = true;
    formState.submitting = false;
  });

  it('shows ready and enables the button when required fields and legs are valid', () => {
    render(<ActionBar onCancel={vi.fn()} onSubmit={vi.fn()} />);
    expect(screen.getByText('Sẵn sàng tạo lệnh')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Tạo lệnh/ })).not.toBeDisabled();
  });

  it('gates the button behind leg validity with a specific hint when required fields are done', () => {
    formState.legsValid = false;
    render(<ActionBar onCancel={vi.fn()} onSubmit={vi.fn()} />);
    expect(screen.getByText('Chặng chưa hợp lệ — cần đủ điểm đi, điểm đến và quãng đường không âm')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Tạo lệnh/ })).toBeDisabled();
  });

  it('keeps the missing-required-fields message when fields AND legs are incomplete', () => {
    formState.requiredFieldsFilled = 4;
    formState.legsValid = false;
    render(<ActionBar onCancel={vi.fn()} onSubmit={vi.fn()} />);
    expect(screen.getByText('Còn 3 trường bắt buộc chưa điền')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Tạo lệnh/ })).toBeDisabled();
  });
});
