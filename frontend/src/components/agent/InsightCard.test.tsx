import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { InsightCard } from './InsightCard';
import type { AgentResponse } from '@tingting/shared';

type InsightCardResponse = Extract<AgentResponse, { type: 'insight_card' }>;

describe('InsightCard', () => {
  it('renders trailing analysis in addition to the structured widgets', () => {
    const card: InsightCardResponse = {
      type: 'insight_card',
      title: 'Phân tích kinh doanh tháng 7/2026',
      summary: 'Doanh thu 256,8 triệu.',
      details: '**Xe ngoài lỗ 4,6 triệu** – cần xem lại đơn giá.',
      widgets: [{
        type: 'kpi_grid',
        items: [{ label: 'Doanh thu', value: 256849093, format: 'vnd' }],
      }, {
        type: 'bar_chart',
        title: 'Lợi nhuận theo xe',
        data: [{ name: 'Xe ngoài', value: -4656967 }],
        format: 'vnd',
      }, {
        type: 'table',
        title: 'Công nợ phải thu',
        columns: ['Khoảng', 'Số tiền'],
        rows: [['Quá hạn', '53.168.000 ₫']],
      }],
    };

    const { container } = render(<InsightCard card={card} />);

    expect(container.textContent).toContain('256.849.093');
    expect(container.textContent).toContain('Lợi nhuận theo xe');
    expect(container.textContent).toContain('Công nợ phải thu');
    expect(container.textContent).toContain('Xe ngoài lỗ 4,6 triệu');
    expect(container.querySelector('.agent-card__details strong')).not.toBeNull();
  });

  it('renders agent table widgets as two-column display records', () => {
    const card: InsightCardResponse = {
      type: 'insight_card',
      title: 'Xe đầu kéo 15C-136.31',
      summary: 'Thông tin xe và lốp đang gắn',
      widgets: [
        {
          type: 'table',
          columns: ['Thông tin', 'Giá trị'],
          rows: [
            ['Biển số', '15C-136.31'],
            ['Trạm kéo', '40FT'],
          ],
        },
        {
          type: 'table',
          columns: ['Serial', 'Vị trí', 'Cỡ'],
          rows: [
            ['295304044', 'Lốp lái đầu kéo', '295/75R22.5'],
            ['295304045', 'Lốp phụ', '295/75R22.5'],
          ],
        },
      ],
    };

    const { container } = render(<InsightCard card={card} />);

    expect(container.querySelector('table')).toBeNull();
    expect(container.querySelectorAll('.agent-field-list .agent-record-field')).toHaveLength(2);
    expect(container.querySelectorAll('.agent-record-card')).toHaveLength(2);
    expect(container.textContent).toContain('Serial');
    expect(container.textContent).toContain('295304044');
    expect(container.textContent).toContain('Lốp phụ');
  });
});
