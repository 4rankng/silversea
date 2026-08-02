// AgentAssistant — the topbar launcher button + the chat drawer, wired
// together (they share open state, the chat hook, and the directive bridge).
// Shown only for office staff on deployments where the bot is enabled
// (capabilities.botEnabled). The drawer renders user bubbles + assistant
// answers (text or <InsightCard>), a streaming "thinking" indicator, and an
// input that sends each turn with the current route as context.
import { memo, useCallback, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode, type Ref } from 'react';
import { useLocation } from 'react-router-dom';
import { SendHorizontal } from 'lucide-react';
import ReactMarkdown, { type Components } from 'react-markdown';
import { Drawer } from '../UI';
import { AssetIcon } from '../AssetIcon';
import { useAuth } from '../../hooks/useAuth';
import { useAgentChat } from '../../hooks/useAgentChat';
import { useAgentDirectives } from '../../context/AgentDirectiveContext';
import { Role } from '@tingting/shared';
import { ErrorBoundary } from '../shared/ErrorBoundary';
import { InsightCard } from './InsightCard';
import type { AgentDirective, AgentMessage, AgentResponse } from '@tingting/shared';
import { BRAND } from '../../brand';
import './agent.css';

const OFFICE_ROLES: Role[] = [Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT];

export function AgentAssistant() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const threadRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const latestInsightCardRef = useRef<HTMLDivElement | null>(null);
  const isPinnedToBottom = useRef(true);
  const location = useLocation();
  const { send: sendDirective } = useAgentDirectives();

  const handleDirective = useCallback(
    (directive: AgentDirective) => {
      if (directive.kind === 'navigate' || directive.kind === 'focus') {
        setOpen(false);
      }
      return sendDirective(directive);
    },
    [sendDirective],
  );

  const chat = useAgentChat({
    onDirective: handleDirective,
  });

  const scrollToLatest = useCallback((behavior: ScrollBehavior = 'auto') => {
    bottomRef.current?.scrollIntoView({ block: 'end', behavior });
  }, []);

  const latestMessage = chat.messages.at(-1);
  const shouldRevealLatestFromTop = latestMessage?.role === 'assistant'
    && latestMessage.response?.type === 'insight_card';

  const revealLatest = useCallback((behavior: ScrollBehavior = 'auto') => {
    if (shouldRevealLatestFromTop && latestInsightCardRef.current) {
      isPinnedToBottom.current = false;
      latestInsightCardRef.current.scrollIntoView({ block: 'start', behavior });
      return;
    }
    isPinnedToBottom.current = true;
    scrollToLatest(behavior);
  }, [scrollToLatest, shouldRevealLatestFromTop]);

  const handleThreadScroll = useCallback(() => {
    const el = threadRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    isPinnedToBottom.current = distanceFromBottom < 80;
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    isPinnedToBottom.current = !shouldRevealLatestFromTop;
    const frame = requestAnimationFrame(() => revealLatest('auto'));
    const timers = shouldRevealLatestFromTop
      ? []
      : [
          window.setTimeout(() => revealLatest('auto'), 80),
          window.setTimeout(() => revealLatest('auto'), 220),
        ];
    return () => {
      cancelAnimationFrame(frame);
      timers.forEach(window.clearTimeout);
    };
  }, [open, revealLatest, shouldRevealLatestFromTop]);

  useLayoutEffect(() => {
    if (!open || !isPinnedToBottom.current) return;
    requestAnimationFrame(() => scrollToLatest('smooth'));
  }, [open, chat.messages.length, chat.isThinking, scrollToLatest]);

  useLayoutEffect(() => {
    if (!open || !chat.streamingMessage?.content || !isPinnedToBottom.current) return;
    const frame = requestAnimationFrame(() => {
      if (isPinnedToBottom.current) scrollToLatest('auto');
    });
    return () => cancelAnimationFrame(frame);
  }, [open, chat.streamingMessage?.content, scrollToLatest]);

  // Hide entirely unless this is an office-staff user on a bot-enabled deploy.
  if (!user || !OFFICE_ROLES.includes(user.role) || !user.botEnabled) return null;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || chat.isThinking) return;
    setInput('');
    void chat.send(text, location.pathname);
  };

  return (
    <>
      <button
        type="button"
        className="topbar__icon-btn agent-launcher"
        title={`Trợ lý ${BRAND.name}`}
        aria-label="Mở trợ lý"
        onClick={() => setOpen(true)}
      >
        <AssetIcon name="assistant" size={24} className="agent-launcher__icon" />
      </button>

      <Drawer
        isOpen={open}
        onClose={() => setOpen(false)}
        title={`Trợ lý ${BRAND.name}`}
        subtitle="Hỏi dữ liệu, phân tích, hoặc điều hướng"
        className="agent-drawer"
        headerGraphic={
          <span className="agent-header-icon" aria-hidden="true">
            <AssetIcon name="assistant" size={52} />
            <span className="agent-header-icon__status" />
          </span>
        }
      >
        <div className="agent-thread" ref={threadRef} onScroll={handleThreadScroll}>
          {chat.messages.length === 0 && (
            <div className="agent-empty">
              <AssetIcon name="assistant" size={96} className="agent-empty__icon" />
              <p>Hỏi tôi về chuyến, công nợ, lợi nhuận, chi phí…</p>
              <p className="agent-empty__hint">VD: <em>“Tháng này vì sao lợi nhuận thấp?”</em> hoặc <em>“mở công nợ khách X”</em></p>
            </div>
          )}

          {chat.messages.map((m) => (
            <MessageBubble
              key={m.id}
              message={m}
              onAction={handleDirective}
              messageRef={
                shouldRevealLatestFromTop && m.id === latestMessage?.id
                  ? latestInsightCardRef
                  : undefined
              }
            />
          ))}

          {/* Live streaming bubble: tokens accumulate here before RUN_FINISHED
              replaces it with the finalized message. Only renders once the first
              token lands (content non-empty); before that the thinking dots show. */}
          {chat.isThinking && chat.streamingMessage && chat.streamingMessage.content && (
            <div className="agent-message agent-message--assistant">
              <span className="agent-message__avatar" aria-hidden="true">
                <AssetIcon name="assistant" size={24} />
              </span>
              <div className="agent-bubble agent-bubble--assistant agent-markdown">
                <MarkdownContent content={chat.streamingMessage.content} />
              </div>
            </div>
          )}

          {chat.isThinking && (!chat.streamingMessage || !chat.streamingMessage.content) && (
            <div className="agent-thinking">
              <span className="agent-message__avatar" aria-hidden="true">
                <AssetIcon name="assistant" size={24} />
              </span>
              <span className="agent-thinking__dot" />
              {chat.activeTool ? (
                <span className="agent-thinking__tool">{chat.activeTool.label ?? chat.activeTool.name}…</span>
              ) : (
                <span className="agent-thinking__tool">
                  {chat.received ? 'Đang xử lý…' : 'Đang suy nghĩ…'}
                </span>
              )}
            </div>
          )}

          {chat.error && <div className="agent-error">{chat.error}</div>}
          <div ref={bottomRef} aria-hidden="true" />
        </div>

        <form className="agent-composer" onSubmit={submit}>
          <input
            className="agent-composer__input"
            placeholder="Hỏi trợ lý…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            autoFocus
          />
          <button
            type="submit"
            className="agent-composer__send"
            disabled={chat.isThinking || !input.trim()}
            aria-label="Gửi tin nhắn"
            title="Gửi tin nhắn"
          >
            <SendHorizontal size={16} aria-hidden="true" />
          </button>
        </form>
      </Drawer>
    </>
  );
}

function MessageBubble({
  message,
  onAction,
  messageRef,
}: {
  message: AgentMessage;
  onAction: (d: AgentDirective) => void;
  messageRef?: Ref<HTMLDivElement>;
}) {
  if (message.role === 'user') {
    return <div className="agent-bubble agent-bubble--user">{message.content}</div>;
  }
  return (
    <ErrorBoundary fallback={<AssistantRenderFallback />}>
      <AssistantResponse message={message} onAction={onAction} messageRef={messageRef} />
    </ErrorBoundary>
  );
}

interface AgentRenderContext {
  message: AgentMessage;
  onAction: (d: AgentDirective) => void;
  messageRef?: Ref<HTMLDivElement>;
}

type ResponseRenderer = (response: AgentResponse, ctx: AgentRenderContext) => ReactNode;

const RESPONSE_RENDERERS: Record<AgentResponse['type'], ResponseRenderer> = {
  insight_card: (response, ctx) => (
    response.type === 'insight_card'
      ? <InsightCard card={response} onAction={ctx.onAction} rootRef={ctx.messageRef} />
      : null
  ),
  directive: () => <AssistantTextBubble content="Đã mở trang cho bạn." />,
  text: (response, ctx) => {
    if (response.type !== 'text') return null;
    return <AssistantTextBubble content={response.content} actions={response.actions} onAction={ctx.onAction} />;
  },
};

function AssistantResponse({
  message,
  onAction,
  messageRef,
}: {
  message: AgentMessage;
  onAction: (d: AgentDirective) => void;
  messageRef?: Ref<HTMLDivElement>;
}) {
  const response = message.response;
  if (response) {
    const renderer = RESPONSE_RENDERERS[response.type];
    const rendered = renderer?.(response, { message, onAction, messageRef });
    if (rendered) return rendered;
  }
  return <AssistantTextBubble content={message.content} />;
}

function AssistantTextBubble({
  content,
  actions,
  citations,
  onAction,
}: {
  content: string | undefined;
  actions?: Extract<AgentResponse, { type: 'text' }>['actions'];
  citations?: import('@tingting/shared').AgentCitation[];
  onAction?: (d: AgentDirective) => void;
}) {
  return (
    <div className="agent-message agent-message--assistant">
      <span className="agent-message__avatar" aria-hidden="true">
        <AssetIcon name="assistant" size={24} />
      </span>
      <div className="agent-bubble agent-bubble--assistant agent-markdown">
        <MarkdownContent content={content} />
        {actions && actions.length > 0 && (
          <div className="agent-card__actions agent-text-actions">
            {actions.map((action, index) => (
              <button
                type="button"
                className="agent-action-chip"
                key={`${action.label}-${index}`}
                onClick={() => onAction?.(action.directive)}
              >
                {action.label}
              </button>
            ))}
          </div>
        )}
        {citations && citations.length > 0 && <CitationChips citations={citations} />}
      </div>
    </div>
  );
}

/** P2 — citation chips rendered under grounded answers (doc-RAG provenance). */
function CitationChips({ citations }: { citations: import('@tingting/shared').AgentCitation[] }) {
  return (
    <div className="agent-citations">
      {citations.map((c, i) => (
        <span className="agent-citation-chip" key={`${c.sourceId}-${i}`} title={c.sourceId}>
          {c.url ? `📄 ${c.label}` : `📋 ${c.label}`}
        </span>
      ))}
    </div>
  );
}

function AssistantRenderFallback() {
  return <AssistantTextBubble content="Không thể hiển thị phản hồi này." />;
}

type MarkdownSegment =
  | { kind: 'markdown'; content: string }
  | { kind: 'table'; headers: string[]; rows: string[][] };

const INLINE_MARKDOWN_COMPONENTS: Components = {
  p: ({ children }) => <>{children}</>,
};

function MarkdownContent({ content }: { content: string | undefined }) {
  const segments = parseMarkdownSegments(normalizeMarkdownEscapes(content ?? ''));
  if (segments.length === 0) return null;

  return (
    <>
      {segments.map((segment, index) => {
        if (segment.kind === 'table') {
          return <MarkdownTable key={`table-${index}`} headers={segment.headers} rows={segment.rows} />;
        }
        return <ReactMarkdown key={`markdown-${index}`} skipHtml>{segment.content}</ReactMarkdown>;
      })}
    </>
  );
}

function MarkdownTable({ headers, rows }: { headers: string[]; rows: string[][] }) {
  if (headers.length === 2) {
    return (
      <div className="agent-markdown-table agent-field-list">
        {rows.map((row, rowIndex) => (
          <div className="agent-record-field" key={row.join('|') || rowIndex}>
            <div className="agent-record-field__label">
              <MarkdownInline content={row[0]?.trim() || '-'} />
            </div>
            <div className="agent-record-field__value">
              <MarkdownInline content={row[1]?.trim() || '-'} />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="agent-markdown-table agent-record-list">
      {rows.map((row, rowIndex) => (
        <div className="agent-record-card" key={row.join('|') || rowIndex}>
          {headers.map((header, cellIndex) => {
            const value = row[cellIndex]?.trim() || '-';
            return (
              <div className="agent-record-field" key={`${rowIndex}-${header}-${cellIndex}`}>
                <div className="agent-record-field__label">
                  <MarkdownInline content={header} />
                </div>
                <div className="agent-record-field__value">
                  <MarkdownInline content={value} />
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

const MarkdownInline = memo(function MarkdownInline({ content }: { content: string }) {
  // Plain text is the common case for table cells (numbers/names); skip the
  // react-markdown parse unless the cell actually contains markdown syntax.
  if (!/[*_`~[\]()#\\]/.test(content)) return <>{content}</>;
  return (
    <ReactMarkdown skipHtml components={INLINE_MARKDOWN_COMPONENTS}>
      {content}
    </ReactMarkdown>
  );
});

function parseMarkdownSegments(content: string): MarkdownSegment[] {
  const normalized = normalizeInlinePipeTables(content);
  const lines = normalized.split('\n');
  const segments: MarkdownSegment[] = [];
  const pendingMarkdown: string[] = [];

  const flushMarkdown = () => {
    const text = pendingMarkdown.join('\n').trim();
    pendingMarkdown.length = 0;
    if (text) segments.push({ kind: 'markdown', content: text });
  };

  for (let i = 0; i < lines.length; i += 1) {
    const header = parseTableRow(lines[i]);
    const separator = parseTableRow(lines[i + 1] ?? '');
    if (header && separator && isMarkdownTableSeparator(separator)) {
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length) {
        const row = parseTableRow(lines[i]);
        if (!row || isMarkdownTableSeparator(row)) break;
        if (row.length === header.length) rows.push(row);
        i += 1;
      }
      i -= 1;
      if (rows.length > 0) {
        flushMarkdown();
        segments.push({ kind: 'table', headers: header, rows });
        continue;
      }
    }
    pendingMarkdown.push(lines[i]);
  }

  flushMarkdown();
  return segments;
}

function normalizeMarkdownEscapes(content: string): string {
  // Un-escape the model's stray backslash-punctuation so it doesn't render as a
  // literal backslash. Deliberately EXCLUDE `|` and `` ` ``: an escaped pipe
  // must survive into the renderer (otherwise it becomes a table column
  // separator inside a cell), and an escaped backtick must not open a code span.
  return content.replace(/\\([\\*_[\]{}()#+.!>-])/g, '$1');
}

function normalizeInlinePipeTables(content: string): string {
  return content
    .replace(/:\s*\|/g, ':\n\n|')
    .replace(/\|\s+\|/g, '|\n|');
}

function parseTableRow(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.includes('|')) return null;
  const cells = trimmed
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
  return cells.length >= 2 && cells.every(Boolean) ? cells : null;
}

function isMarkdownTableSeparator(cells: string[]): boolean {
  return cells.length >= 2 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}
