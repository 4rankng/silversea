import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentEvent } from '@tingting/shared';

const mocks = vi.hoisted(() => ({
  streamAgentChat: vi.fn(),
}));

vi.mock('../api/agentClient', () => ({
  agentClient: { getConversation: vi.fn() },
  streamAgentChat: mocks.streamAgentChat,
  sendActionResult: vi.fn(),
  loadSavedConversationId: vi.fn(() => null),
  persistConversationId: vi.fn(),
}));

import { useAgentChat } from './useAgentChat';

describe('useAgentChat message preservation', () => {
  beforeEach(() => {
    mocks.streamAgentChat.mockReset();
  });

  it('appends a later summary without replacing the earlier insight card', async () => {
    const responses: AgentEvent[] = [
      {
        type: 'RUN_FINISHED',
        conversationId: '42',
        response: {
          type: 'insight_card',
          title: 'Phân tích kinh doanh tháng 7/2026',
          summary: 'Doanh thu 256,8 triệu.',
          widgets: [{
            type: 'kpi_grid',
            items: [{ label: 'Doanh thu', value: 256849093, format: 'vnd' }],
          }],
        },
      },
      {
        type: 'RUN_FINISHED',
        conversationId: '42',
        response: { type: 'text', content: 'Tóm tắt bổ sung.' },
      },
    ];
    mocks.streamAgentChat.mockImplementation(async (_input, onEvent: (event: AgentEvent) => void) => {
      const response = responses.shift();
      if (response) onEvent(response);
    });

    const { result } = renderHook(() => useAgentChat());

    await act(async () => {
      await result.current.send('phân tích tình hình kinh doanh tháng này');
    });
    await act(async () => {
      await result.current.send('phân tích tình hình kinh doanh tháng này');
    });

    expect(result.current.messages).toHaveLength(4);
    expect(result.current.messages[1].response?.type).toBe('insight_card');
    expect(result.current.messages[3].response).toEqual({
      type: 'text',
      content: 'Tóm tắt bổ sung.',
    });
  });

  it('keeps a detailed streamed answer when the terminal response is only a summary', async () => {
    const detailedAnswer = [
      'Doanh thu tháng 6 đạt 689,3 triệu đồng và lợi nhuận gộp là 171,5 triệu đồng, tương ứng biên 24,9%.',
      'Kết quả đến từ 85 chuyến xe, trong đó nhóm tuyến có doanh thu ổn định giữ được biên lợi nhuận tốt.',
      'Cần kiểm tra xe 15C-136.31 vì chi phí bảo dưỡng bất thường lên 25,4 triệu đồng; đây là khoản làm giảm đáng kể lợi nhuận trong kỳ.',
    ].join(' ');
    const events: AgentEvent[] = [
      { type: 'TEXT_MESSAGE_START', messageId: 'stream-1' },
      { type: 'TEXT_MESSAGE_CONTENT', messageId: 'stream-1', delta: detailedAnswer },
      { type: 'TEXT_MESSAGE_END', messageId: 'stream-1' },
      {
        type: 'RUN_FINISHED',
        conversationId: '42',
        response: {
          type: 'text',
          content: 'Doanh thu 689,3 triệu, lợi nhuận gộp 171,5 triệu. Cần kiểm tra xe 15C-136.31.',
        },
      },
    ];
    mocks.streamAgentChat.mockImplementation(async (_input, onEvent: (event: AgentEvent) => void) => {
      events.forEach(onEvent);
    });

    const { result } = renderHook(() => useAgentChat());

    await act(async () => {
      await result.current.send('phân tích tình hình kinh doanh tháng 6');
    });

    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[1].response).toEqual({ type: 'text', content: detailedAnswer });
  });
});
