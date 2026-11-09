// SIL-717 (id 837) — the "Thêm container" form pins the copy law at the
// layer the operator sees.
//
// WHY (QA retest 08/11, staging c4cea6b6): a driver script injected the
// row-1 weight through the DOM without React state ever hearing about it,
// so the row landed with `cargo_weight_kg = NULL` and the add form seeded
// EMPTY — reading like a copy regression. The wire chain itself
// (`containerCopyLaw` → `cusContainerAddCopy` → `cusContainerAddPayload`
// → the server's explicit-value insert) is already pinned in
// `cus/cusContainerAdd.test.ts`; these tests pin the LAST visible hop: the
// form must show the copied trọng lượng as the input's seed, and keep it on
// the entry when the operator only fills the two identifiers.
//
// Verified live on origin/main 09/11 (lot 779460, CUS tiepvv): row 1
// 12.000 kg → form seed '12000.00' → row 2 stored `12000.00` with number +
// type as the operator's own entry.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { ContainerAddForm, type ContainerAddFormProps } from './ContainerAddForm';
import type { ContainerAddCopy } from './containerCopyLaw';

const copiedRow: ContainerAddCopy = {
  cargoWeightKg: '12000.00',
  cargoVolumeCbm: '12.500',
  routeId: 9,
  operationalSiteId: 7,
  liftSiteId: 3,
  dropoffSiteId: 4,
  customerAppointmentAt: '2026-11-20T03:00:00.000Z',
};

function renderForm(overrides: Partial<ContainerAddFormProps> = {}) {
  const onSubmit = vi.fn();
  const view = render(
    <ContainerAddForm
      copy={copiedRow}
      containerTypes={[{ id: 1, code: '20DC' }, { id: 2, code: '40HC' }]}
      copySummary="Copy từ container 1 · ASKEY-XƯỞNG 1 · KCN QUẾ VÕ, BẮC NINH · Cảng Green Port · Cảng Chùa Vẽ · 20/11 10:00"
      saving={false}
      error={null}
      onSubmit={onSubmit}
      onCancel={vi.fn()}
      {...overrides}
    />,
  );
  const number = view.container.querySelector('input[id$="-container-number"]') as HTMLInputElement;
  const weight = view.container.querySelector('input[id$="-container-weight"]') as HTMLInputElement;
  const type = view.container.querySelector('select') as HTMLSelectElement;
  const submit = [...view.container.querySelectorAll('button')]
    .find((button) => button.textContent?.trim() === 'Thêm container') as HTMLButtonElement;
  return { onSubmit, view, number, weight, type, submit };
}

describe('ContainerAddForm — SIL-717 copy law (copy all except số cont + loại cont)', () => {
  it('SIL-717: the weight input rides the row above — the seed is the copied value, not empty', () => {
    const { weight } = renderForm();
    expect(weight).toBeTruthy();
    expect(weight.value).toBe('12000.00');
  });

  it('SIL-717: the two identifiers stay EMPTY for the operator — number and type never inherit', () => {
    const { number, type } = renderForm();
    expect(number.value).toBe('');
    expect(type.value).toBe('');
  });

  it('SIL-717: an untouched weight rides the entry — filling only the two identifiers keeps the copy', () => {
    const { number, type, submit, onSubmit } = renderForm();
    fireEvent.change(number, { target: { value: 'TSTU1712100' } });
    fireEvent.change(type, { target: { value: '1' } });
    fireEvent.click(submit);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith({
      containerNumber: 'TSTU1712100',
      containerTypeId: '1',
      cargoWeightKg: '12000.00',
    });
  });

  it('SIL-717: an operator override wins — typing a weight replaces the seed', () => {
    const { number, weight, submit, onSubmit } = renderForm();
    fireEvent.change(number, { target: { value: 'TSTU1712100' } });
    fireEvent.change(weight, { target: { value: '24000' } });
    fireEvent.click(submit);
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ cargoWeightKg: '24000' }));
  });
});
