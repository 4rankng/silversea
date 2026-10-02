// testplan/qa/lib/selectors.mjs — single source of truth for UI selectors.
//
// Every case and helper should import selectors from here. If the app's DOM
// changes (e.g. a new wrapper class), update this file once — not in 20 case
// files. Per AGENTS.md "Stable Code Artifacts": keep selectors in ONE place,
// not scattered across cases.

/**
 * Predicates used to find React-Aria comboboxes by their accessible label or
 * placeholder. The app uses `<input role="combobox">` driven by
 * `react-aria-ComboBox`; the X (clear) button sits 1–2 ancestors up and has
 * `aria-label="Xoá"`.
 */
export const SEL = {
  comboboxByAriaLabel: (label) =>
    `input[role="combobox"][aria-label="${label}"]`,

  comboboxByPlaceholder: (placeholder) =>
    `input[role="combobox"][placeholder="${placeholder}"]`,

  /** Button used to clear a combobox value. */
  clearButton: 'button[aria-label="Xoá"]',

  /** The Hình thức xuất nhập khẩu field is a UUI Select, not a combobox. */
  hinhThucInput: 'input[placeholder="Chọn Nhập hoặc Xuất"]',

  /** Submit button on the form. */
  submitButtonText: 'Tạo lô hàng',

  /**
   * The workboard text search, by ACCESSIBLE NAME. `ListFilterBar` renders the
   * field with `aria-label` (ShipmentsPage.tsx:490 'Tìm lô hàng',
   * ShipmentContainersPage.tsx:251 'Container, Bill/Booking hoặc tờ khai'); the
   * placeholder is copy that changes with the wording of the field, so a
   * placeholder selector rots the moment the label is reworded.
   */
  searchInput: (ariaLabel) => `input[aria-label="${ariaLabel}"]`,

  /** Per-shipment detail button inside a workboard row (CusShipmentRow.tsx:235
   * renders `cus-dashboard-detail-<id>`), so a case can open a NAMED lot. */
  rowDetailButton: (shipmentId) => `#cus-dashboard-detail-${shipmentId}`,

  /** The empty-ledger line a container-less lot renders in its drawer. */
  containerLedgerEmpty: '.cus-detail-empty',
};


/** Async `evaluate` helpers that mirror the selectors for runtime use. */
export const QE = {
  comboboxByAriaLabel: (label) => `
    Array.from(document.querySelectorAll('input[role="combobox"]'))
      .find((el) => el.getAttribute('aria-label') === ${JSON.stringify(label)}) || null
  `,

  comboboxByPlaceholder: (placeholder) => `
    Array.from(document.querySelectorAll('input[role="combobox"]'))
      .find((el) => el.placeholder === ${JSON.stringify(placeholder)}) || null
  `,

  comboboxByPlaceholderRegex: (regexSource) => `
    Array.from(document.querySelectorAll('input[role="combobox"]'))
      .find((el) => new RegExp(${JSON.stringify(regexSource)}).test(el.placeholder || '')) || null
  `,

  /** Find the listbox option matching `optionText` and click it. */
  clickListboxOptionMatching: (optionText) => `
    (() => {
      const list = document.querySelector('[role="listbox"]');
      if (!list) return { ok: false, error: 'no listbox' };
      const opt = Array.from(list.querySelectorAll('[role="option"]'))
        .find((el) => new RegExp(${JSON.stringify(optionText)}, 'i').test(el.textContent || ''));
      if (!opt) return { ok: false, error: 'no matching option in listbox' };
      const txt = (opt.textContent || '').trim().slice(0, 80);
      opt.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      opt.click();
      return { ok: true, picked: txt };
    })()
  `,

  /** Click the first option in the open listbox. */
  clickFirstListboxOption: `
    (() => {
      const list = document.querySelector('[role="listbox"]');
      if (!list) return null;
      const opt = list.querySelector('[role="option"]');
      if (!opt) return null;
      const txt = (opt.textContent || '').trim().slice(0, 80);
      opt.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      opt.click();
      return txt;
    })()
  `,

  /** Click X clear button for a combobox identified by aria-label. */
  clickClearForCombobox: (label) => `
    (() => {
      const cb = Array.from(document.querySelectorAll('input[role="combobox"]'))
        .find((el) => el.getAttribute('aria-label') === ${JSON.stringify(label)});
      if (!cb) return { ok: false, error: 'combobox not found' };
      let root = cb;
      for (let i = 0; i < 8; i++) {
        root = root.parentElement;
        if (!root) break;
        const btn = root.querySelector('button[aria-label="Xoá"]');
        if (btn) {
          btn.click();
          return { ok: true };
        }
      }
      return { ok: false, error: 'no Xoá button in ancestors' };
    })()
  `,

  /** Read the current value of a combobox by aria-label. */
  comboboxValue: (label) => `
    (() => {
      const cb = Array.from(document.querySelectorAll('input[role="combobox"]'))
        .find((el) => el.getAttribute('aria-label') === ${JSON.stringify(label)});
      return cb ? cb.value : null;
    })()
  `,

  /** Click the form submit button by its text label. */
  clickSubmitButton: (text) => `
    (() => {
      const b = Array.from(document.querySelectorAll('button'))
        .find((el) => (el.textContent || '').trim() === ${JSON.stringify(text)});
      if (!b) return { ok: false, error: 'button not found' };
      b.scrollIntoView({ block: 'center' });
      b.click();
      return { ok: true };
    })()
  `,

  /** Find table row containing given text and return its text snippet. Accepts
   * a string (literal includes) or a RegExp. */
  tableRowContaining: (fragment) => {
    const test = fragment instanceof RegExp
      ? `(${fragment.source}).test(r.textContent || '')`
      : `(r.textContent || '').includes(${JSON.stringify(fragment)})`;
    return `
      (() => {
        const rows = Array.from(document.querySelectorAll('tr, [role="row"]'));
        for (const r of rows) {
          if (${test}) {
            return (r.textContent || '').slice(0, 600);
          }
        }
        return null;
      })()
    `;
  },

  /**
   * First Bill/Booking reference actually RENDERED in a workboard row, or null.
   * Cases that need a "known ref" read it from the page instead of hardcoding
   * one: a hardcoded ref is either missing from the env under test (a false
   * FAIL) or, worse, present in one env only.
   */
  firstRenderedBillOrBookRef: `
    (() => {
      const rows = Array.from(document.querySelectorAll('.cus-dashboard-table tbody tr'));
      for (const tr of rows) {
        const ref = (tr.querySelector("td[data-label='Chứng từ'] strong")?.innerText || '').trim();
        if (ref && !ref.startsWith('Chưa có')) return ref;
      }
      return null;
    })()
  `,

  /**
   * The per-shipment detail button for `id`, scrolled into view. Returns the
   * row's aria-label so the evidence records WHICH lot was opened.
   */
  clickRowDetailButton: (id) => `
    (() => {
      const btn = document.getElementById('cus-dashboard-detail-' + ${JSON.stringify(String(id))});
      if (!btn) return null;
      btn.scrollIntoView({ block: 'center' });
      btn.click();
      return btn.getAttribute('aria-label');
    })()
  `,

  /** Container-ledger table + the empty-ledger line, as one read. */
  containerLedgerState: `
    (() => {
      const table = document.querySelector('.shipment-container-ledger table, .cus-container-ledger table');
      const empty = document.querySelector('.cus-detail-empty');
      return {
        hasTable: Boolean(table),
        rowCount: table ? table.querySelectorAll('tbody tr').length : 0,
        emptyText: empty ? (empty.innerText || '').trim() : null,
      };
    })()
  `,

  /** The Hình thức xuất nhập khẩu field is a UUI-styled native <select>
   * wrapped in a label. Set the underlying <select> value + dispatch change. */
  setHinhThucValue: (value) => `
    (() => {
      const labels = Array.from(document.querySelectorAll('label'));
      const popoverLabel = labels.find((l) => {
        const t = (l.textContent || '').trim();
        return t.includes('Nhập khẩu') && t.includes('Xuất khẩu') && t.length < 80;
      });
      if (!popoverLabel) return { ok: false, error: 'hình thức label not found' };
      const sel = popoverLabel.querySelector('select');
      if (!sel) return { ok: false, error: 'hình thức select not found' };
      const setValue = sel.value;
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
      nativeInputValueSetter.call(sel, ${JSON.stringify(value)});
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true, picked: ${JSON.stringify(value)}, previousValue: setValue };
    })()
  `,
};
