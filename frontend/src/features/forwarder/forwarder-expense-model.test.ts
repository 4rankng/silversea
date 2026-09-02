import { describe, expect, it } from 'vitest';
import {
  buildEditExpenseForm,
  buildExpensePayload,
  buildUpdateExpensePayload,
  hasMarkupPolicy,
  newExpenseForm,
  resolveLiftContext,
  resolveNoInvoicePolicy,
  singleContainerPrefill,
  validateExpenseForm,
} from './forwarder-expense-model';

const validCtx = { isLiftExpense: false, matrixPriceValid: false, noInvoiceAllowed: true };

/** Form that passes validation: has invoice + positive amounts. */
function invoicedForm() {
  const form = newExpenseForm();
  form.buyAmount = '500000';
  form.sellAmount = '500000';
  form.invoiceNumber = 'HD-001';
  form.note = 'Lifting tại cảng';
  return form;
}

describe('validateExpenseForm', () => {
  it('rejects lift rows without a valid price matrix before other checks', () => {
    const form = newExpenseForm();
    form.buyAmount = '';
    const errors = validateExpenseForm(form, { ...validCtx, isLiftExpense: true, matrixPriceValid: false });
    expect(errors.buyAmount).toBe('Chưa có biểu giá nâng/hạ hợp lệ cho Cảng + Loại cont + Hàng/Rỗng đã chọn');
    // Matrix error wins — the generic >0 message is not stacked on top.
    expect(Object.values(errors).filter(v => v === 'Giá mua vào phải lớn hơn 0')).toHaveLength(0);
  });

  it('requires a positive buy amount on non-lift rows', () => {
    const form = invoicedForm();
    form.buyAmount = '0';
    const errors = validateExpenseForm(form, validCtx);
    expect(errors.buyAmount).toBe('Giá mua vào phải lớn hơn 0');
  });

  it('requires the customs declaration number for CUSTOMS rows', () => {
    const form = invoicedForm();
    form.expenseType = 'CUSTOMS';
    const errors = validateExpenseForm(form, validCtx);
    expect(errors.declarationNumber).toBe('Số tờ khai hải quan là bắt buộc cho phí hải quan');
  });

  it('requires a supplier when the company pays directly', () => {
    const form = invoicedForm();
    form.settlementMethod = 'COMPANY_DIRECT';
    const errors = validateExpenseForm(form, validCtx);
    expect(errors.supplierId).toBe('Cần chọn NCC khi công ty trả trực tiếp');
  });

  it('requires the no-invoice evidence bundle only when there is no invoice', () => {
    const form = invoicedForm();
    form.invoiceNumber = '';
    form.expenseDate = '';   // default form carries today's date — clear it to hit the branch
    form.note = '';          // helper pre-fills the note — clear it too
    const errors = validateExpenseForm(form, validCtx);
    expect(errors.expenseDate).toBe('Ngày chi là bắt buộc');
    expect(errors.payeeName).toBe('Người nhận là bắt buộc');
    expect(errors.note).toBe('Lý do chi là bắt buộc');
    expect(errors.evidence).toBe('Cần chọn ít nhất một loại chứng cứ thay thế');
  });

  it('skips the evidence bundle when an invoice number is present', () => {
    const errors = validateExpenseForm(invoicedForm(), validCtx);
    expect(Object.keys(errors)).toHaveLength(0);
  });
});

describe('buildExpensePayload', () => {
  it('maps the form onto the create contract, dropping blanks to undefined', () => {
    const form = invoicedForm();
    const payload = buildExpensePayload(form, { tripId: 15, isLiftExpense: false });
    expect(payload.tripId).toBe(15);
    expect(payload.buyAmount).toBe(500000);
    expect(payload.supplierId).toBeUndefined();
    expect(payload.payeeName).toBeUndefined();   // empty payee (invoice path)
    expect(payload.note).toBe('Lifting tại cảng');
    expect(payload.portId).toBeUndefined();      // non-lift: lift context never sent
    expect(payload.loadState).toBeUndefined();
  });

  it('sends lift context only on lift rows and clamps negative sell amounts', () => {
    const form = invoicedForm();
    form.expenseType = 'LIFTING';
    form.portId = '7';
    form.containerTypeId = '3';
    form.sellAmount = '-5';
    const payload = buildExpensePayload(form, { tripId: 15, isLiftExpense: true });
    expect(payload.portId).toBe(7);
    expect(payload.containerTypeId).toBe(3);
    expect(payload.loadState).toBe('LOADED');
    expect(payload.sellAmount).toBe(0);
  });

  it('includes supplier + container as numbers when selected', () => {
    const form = invoicedForm();
    form.supplierId = '12';
    form.tripContainerId = '91';
    const payload = buildExpensePayload(form, { tripId: 15, isLiftExpense: false });
    expect(payload.supplierId).toBe(12);
    expect(payload.tripContainerId).toBe(91);
  });
});

describe('buildUpdateExpensePayload', () => {
  it('turns cleared fields into explicit nulls and carries the lock token', () => {
    const form = invoicedForm();
    form.payeeName = '';
    form.note = '';
    const base = buildExpensePayload(form, { tripId: 15, isLiftExpense: false });
    const update = buildUpdateExpensePayload(base, form, { id: 44, expectedUpdatedAt: '2026-08-04T10:00:00.000Z' });
    expect(update.id).toBe(44);
    expect(update.expectedUpdatedAt).toBe('2026-08-04T10:00:00.000Z');
    expect(update.supplierId).toBeNull();        // cleared supplier un-sets server-side
    expect(update.payeeName).toBeNull();
    expect(update.note).toBeNull();
    expect(update.tripContainerId).toBeNull();   // not selected on this form
  });

  it('keeps filled fields exactly as the create payload computed them', () => {
    const form = invoicedForm();
    form.tripContainerId = '91';
    const base = buildExpensePayload(form, { tripId: 15, isLiftExpense: false });
    const update = buildUpdateExpensePayload(base, form, { id: 44, expectedUpdatedAt: 't' });
    expect(update.tripContainerId).toBe(91);
    expect(update.invoiceNumber).toBe('HD-001');
    expect(update.buyAmount).toBe(500000);
  });
});

describe('buildEditExpenseForm', () => {
  const containers = [{ id: 91, containerTypeId: 3 }];
  const legs = [{ loadingType: 'VO' }, { loadingType: 'HANG' }];

  it('prefills from the expense and its container, mapping VO legs to EMPTY', () => {
    const form = buildEditExpenseForm({
      id: 44,
      updatedAt: 't',
      expenseType: 'LOWERING',
      buyAmount: 250000,
      sellAmount: null,
      settlementMethod: 'FORWARDER_ADVANCE',
      supplierId: 12,
      tripContainerId: 91,
      expenseDate: '2026-08-04T10:00:00.000Z',
      payeeName: 'Nguyễn Văn A',
      invoiceNumber: null,
      note: 'ghi chú',
    }, containers, legs);
    expect(form.expenseType).toBe('LOWERING');
    expect(form.buyAmount).toBe('250000');
    expect(form.sellAmount).toBe('');
    expect(form.settlementMethod).toBe('OPS_ADVANCE');
    expect(form.supplierId).toBe('12');
    expect(form.tripContainerId).toBe('91');
    expect(form.containerTypeId).toBe('3');
    expect(form.loadState).toBe('EMPTY');        // first leg is VO
    expect(form.expenseDate).toBe('2026-08-04'); // timestamp sliced to a date input value
  });
});

describe('singleContainerPrefill', () => {
  it('prefills the only container with its type and leg-derived load state', () => {
    expect(singleContainerPrefill([{ id: 91, containerTypeId: 3 }], [{ loadingType: 'HANG' }]))
      .toEqual({ tripContainerId: '91', containerTypeId: '3', loadState: 'LOADED' });
  });

  it('returns null for multi-container trips and VO-first legs map to EMPTY', () => {
    expect(singleContainerPrefill([{ id: 1 }, { id: 2 }], [])).toBeNull();
    expect(singleContainerPrefill([{ id: 91 }], [{ loadingType: 'VO' }])?.loadState).toBe('EMPTY');
  });
});

describe('resolveLiftContext + policies', () => {
  it('derives direction and a rising-edge suggestion key from the form', () => {
    const up = resolveLiftContext({ ...newExpenseForm(), portId: '7', containerTypeId: '3', expenseDate: '2026-09-02' });
    expect(up.isLiftExpense).toBe(true);
    expect(up.liftDirection).toBe('LIFT_UP');
    expect(up.suggestionKey).toBe('7|3|LIFT_UP|LOADED|2026-09-02');
    const down = resolveLiftContext({ ...newExpenseForm(), expenseType: 'LOWERING' });
    expect(down.liftDirection).toBe('LIFT_DOWN');
    expect(resolveLiftContext({ ...newExpenseForm(), expenseType: 'CUSTOMS' }).isLiftExpense).toBe(false);
  });

  it('falls back to default evidence types and limits when the catalog is silent', () => {
    const policy = resolveNoInvoicePolicy(undefined);
    expect(policy.noInvoiceAllowed).toBe(true);
    expect(policy.allowedEvidenceTypes.length).toBeGreaterThan(0);
    expect(policy.perItemLimit).toBe(1_000_000);
    expect(policy.perDayLimit).toBe(5_000_000);
  });

  it('disables no-invoice spending for types that require an invoice', () => {
    const policy = resolveNoInvoicePolicy({ code: 'CUSTOMS', name: 'Phí hải quan', requiresInvoice: true });
    expect(policy.noInvoiceAllowed).toBe(false);
    // Markup policy mirrors the shared catalog: customs is marked up, lifting is at cost.
    expect(hasMarkupPolicy('CUSTOMS')).toBe(true);
    expect(hasMarkupPolicy('LIFTING')).toBe(false);
  });
});
