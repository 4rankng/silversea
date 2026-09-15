import { describe, expect, it, vi } from 'vitest';
import { scrollActiveOption } from './scrollActiveOption';

describe('active option visibility', () => {
  it('scrolls only the bounded list to reveal options above and below it', () => {
    const list = document.createElement('ul');
    list.setAttribute('role', 'listbox');
    const option = document.createElement('button');
    list.append(option);
    Object.defineProperty(list, 'clientHeight', { value: 200 });
    vi.spyOn(list, 'getBoundingClientRect').mockReturnValue({ top: 100, bottom: 300 } as DOMRect);
    const optionBox = vi.spyOn(option, 'getBoundingClientRect');
    optionBox.mockReturnValue({ top: 350, bottom: 390 } as DOMRect);
    scrollActiveOption(option);
    expect(list.scrollTop).toBe(90);
    optionBox.mockReturnValue({ top: 70, bottom: 110 } as DOMRect);
    scrollActiveOption(option);
    expect(list.scrollTop).toBe(60);
    optionBox.mockReturnValue({ top: 110, bottom: 150 } as DOMRect);
    scrollActiveOption(option);
    expect(list.scrollTop).toBe(60);
    expect(window.scrollY).toBe(0);
  });
});
