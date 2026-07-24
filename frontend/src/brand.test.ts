import { describe, expect, it } from 'vitest';
import { BRAND } from './brand';

describe('TransTing brand contract', () => {
  it('uses the approved Vietnamese identity copy', () => {
    expect(BRAND).toEqual({
      name: 'TransTing',
      productName: 'TransTing Logistics',
      tagline: 'Vận tải thông minh. Doanh nghiệp vững mạnh.',
      shellDescriptor: 'Quản lý vận tải và logistics',
      logoPath: '/assets/transting-logo-192.png?v=4',
      sidebarLogoPath: '/assets/transting-sidebar-mark-192.png?v=4',
    });
  });
});
