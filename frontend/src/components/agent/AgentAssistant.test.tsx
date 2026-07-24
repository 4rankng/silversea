import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentMessage } from '@tingting/shared';
import { AgentAssistant } from './AgentAssistant';

const chatState = vi.hoisted(() => ({
  messages: [] as AgentMessage[],
  isThinking: false,
  streamingMessage: null as { id: string; content: string } | null,
}));

vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({
    user: { role: 'MANAGER', botEnabled: true },
  }),
}));

vi.mock('../../hooks/useAgentChat', () => ({
  useAgentChat: () => ({
    messages: chatState.messages,
    isThinking: chatState.isThinking,
    received: false,
    activeTool: null,
    streamingMessage: chatState.streamingMessage,
    error: null,
    conversationId: 'conversation-1',
    send: vi.fn(),
    reset: vi.fn(),
  }),
}));

vi.mock('../../context/AgentDirectiveContext', () => ({
  useAgentDirectives: () => ({ send: vi.fn() }),
}));

vi.mock('../../context/TourControllerContext', () => ({
  useTourController: () => ({ start: vi.fn(), cancel: vi.fn() }),
}));

vi.mock('../UI', () => ({
  Drawer: ({ isOpen, children }: { isOpen: boolean; children: React.ReactNode }) => (
    isOpen ? <div>{children}</div> : null
  ),
}));

vi.mock('../AssetIcon', () => ({
  AssetIcon: () => null,
}));

vi.mock('./InsightCard', () => ({
  InsightCard: ({
    card,
    rootRef,
  }: {
    card: { title: string };
    rootRef?: React.Ref<HTMLDivElement>;
  }) => <div ref={rootRef}>{card.title}</div>,
}));

vi.mock('./TutorialCard', () => ({
  TutorialCard: () => null,
}));

describe('AgentAssistant scrolling', () => {
  const scrollIntoView = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    chatState.messages = [];
    chatState.isThinking = false;
    chatState.streamingMessage = null;
    scrollIntoView.mockReset();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('reveals a structured insight card from its beginning when the drawer opens', () => {
    chatState.messages = [{
      id: 'assistant-report',
      role: 'assistant',
      createdAt: '2026-07-24T00:00:00.000Z',
      response: {
        type: 'insight_card',
        title: 'Báo cáo vận hành',
        summary: 'Tổng hợp chuyến đi',
        widgets: [{
          type: 'kpi_grid',
          items: [{ label: 'Chuyến đi', value: 41, format: 'number' }],
        }],
      },
    }];

    render(
      <MemoryRouter>
        <AgentAssistant />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Mở trợ lý' }));
    act(() => vi.runAllTimers());

    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start', behavior: 'auto' });
    expect(scrollIntoView).not.toHaveBeenCalledWith({ block: 'end', behavior: 'auto' });
    expect(scrollIntoView).not.toHaveBeenCalledWith({ block: 'end', behavior: 'smooth' });
  });

  it('keeps ordinary text conversations pinned to the latest line', () => {
    chatState.messages = [{
      id: 'assistant-text',
      role: 'assistant',
      createdAt: '2026-07-24T00:00:00.000Z',
      response: {
        type: 'text',
        content: 'Đã tìm thấy chuyến đi.',
      },
    }];

    render(
      <MemoryRouter>
        <AgentAssistant />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Mở trợ lý' }));
    act(() => vi.runAllTimers());

    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'end', behavior: 'auto' });
    expect(scrollIntoView).not.toHaveBeenCalledWith({ block: 'start', behavior: 'auto' });
  });

  it('uses an icon-only send control with an accessible name', () => {
    render(
      <MemoryRouter>
        <AgentAssistant />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Mở trợ lý' }));

    const sendButton = screen.getByRole('button', { name: 'Gửi tin nhắn' });
    expect(sendButton.textContent).toBe('');
    expect(sendButton.hasAttribute('disabled')).toBe(true);
  });

  it('follows a growing text stream only while the reader remains pinned', () => {
    const renderAssistant = () => (
      <MemoryRouter>
        <AgentAssistant />
      </MemoryRouter>
    );
    const { container, rerender } = render(renderAssistant());

    fireEvent.click(screen.getByRole('button', { name: 'Mở trợ lý' }));
    act(() => vi.runAllTimers());
    scrollIntoView.mockReset();

    chatState.isThinking = true;
    chatState.streamingMessage = { id: 'stream-1', content: 'Đang tổng hợp' };
    rerender(renderAssistant());
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'end', behavior: 'auto' });

    const thread = container.querySelector('.agent-thread');
    expect(thread).not.toBeNull();
    Object.defineProperties(thread!, {
      scrollHeight: { configurable: true, value: 1_000 },
      clientHeight: { configurable: true, value: 500 },
      scrollTop: { configurable: true, value: 100, writable: true },
    });
    fireEvent.scroll(thread!);
    scrollIntoView.mockReset();

    chatState.streamingMessage = { id: 'stream-1', content: 'Đang tổng hợp báo cáo' };
    rerender(renderAssistant());
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});
