import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  CloudOff,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import {
  PORTAL,
  type CustomerWorkInboxItem,
  type DriverWorkInboxItem,
  type OperationsWorkInboxItem,
  type WorkInboxItemBase,
  type WorkInboxResponseOf,
} from '@tingting/shared';
import { api, ApiError } from '../../lib/api';
import { useAuth } from '../../hooks/useAuth';
import { buildOfflineCommandKey, useOfflineCommandQueue } from '../../features/driver/useOfflineCommandQueue';
import { sendRoleOfflineCommand } from '../../features/offline/roleCommandSender';
import { withCustomerScope } from '../../pages/portal/CustomerPortalScope';
import './RoleWorkInbox.css';

type Role = 'operations' | 'driver' | 'customer';
type RoleItem = OperationsWorkInboxItem | DriverWorkInboxItem | CustomerWorkInboxItem;
type InboxData = WorkInboxResponseOf<RoleItem>;

const labels: Record<Role, readonly [string, string, string]> = {
  operations: ['Cần làm', 'Đang chờ', 'Hoàn tất'],
  driver: ['Cần làm', 'Đang chờ', 'Hoàn tất'],
  customer: ['Cần xác nhận', 'Đang xử lý', 'Hoàn tất'], // neutral active-work bucket — "Đang vận chuyển" overstated assigned-not-departed lots
};
const states = ['ACTION', 'WAITING', 'DONE'] as const;
const countKeys = ['action', 'waiting', 'done'] as const;
const STALE_AFTER_MS = 5 * 60 * 1000;

type Props = {
  role: Role;
  title: string;
  description: string;
  customerId?: number | null;
  scopeReady?: boolean;
};

function endpointFor(role: Role, customerId: number | null | undefined, state: typeof states[number], page: number) {
  const query = `view=${state}&page=${page}&limit=100`;
  if (role === 'operations') return `/forwarder/me/work-inbox?${query}`;
  if (role === 'driver') return `/driver/me/work-inbox?${query}`;
  return withCustomerScope(`/portal/work-inbox?${query}`, customerId ?? null);
}

function formatTime(value: string) {
  return new Date(value).toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function statusLabel(item: WorkInboxItemBase) {
  if (item.state === 'ACTION') return 'Cần xử lý';
  if (item.state === 'WAITING') return 'Đang chờ';
  return 'Hoàn tất';
}

// Cross-branch workflow gate per P0-W5. Each row shows the parallel O2C
// branches that gate the next action, so the role doesn't have to drill in
// to learn whether they're waiting on someone else. Two branches:
//   - "Đã phân xe" — dispatcher has assigned plates to every container
//   - "Đã đổi lệnh" — ops has collected the paper order from the customer
// Customer-facing rows don't need this gate; the customer's state is
// "Đang xử lý / Hoàn tất" and the driver-facing row only needs to show
// the gate that blocks *them* (Đã đổi lệnh = ops handoff).
type Gate = { label: string; satisfied: boolean; pending?: string };

function crossBranchGate(item: RoleItem, role: Role): Gate[] {
  if (role === 'driver') {
    const value = item as DriverWorkInboxItem;
    // The driver row only fires after the dispatcher assigned a plate, so
    // "Đã phân xe" is always satisfied here. The real gate for the driver
    // is the paper-order handoff from ops.
    return [
      { label: 'Đã phân xe', satisfied: true },
      {
        label: 'Đã đổi lệnh',
        satisfied: value.paperOrderReady,
        pending: value.paperOrderReady ? undefined : 'Vận hành chưa giao lệnh gốc',
      },
    ];
  }
  if (role === 'operations') {
    const value = item as OperationsWorkInboxItem;
    // Ops sees both branches because they hand off to the driver once both
    // branches are satisfied. Dispatch is the upstream branch; paper-order
    // is the branch they own.
    const dispatched = Boolean(value.driverName && value.truckPlate);
    const paperDone = value.paperOrderState === 'COMPLETED';
    return [
      {
        label: 'Đã phân xe',
        satisfied: dispatched,
        pending: dispatched ? undefined : 'Điều vận chưa gán biển số',
      },
      {
        label: 'Đã đổi lệnh',
        satisfied: paperDone,
        pending: paperDone ? undefined : 'Vận hành chưa bàn giao lệnh giấy',
      },
    ];
  }
  return [];
}

function factsFor(item: RoleItem, role: Role): Array<{ label: string; value: string }> {
  if (role === 'operations') {
    const value = item as OperationsWorkInboxItem;
    return [
      { label: 'Container', value: value.containerSummary || 'Chưa có' },
      { label: 'Tài xế', value: value.driverName || 'Chưa phân' },
      { label: 'Xe', value: value.truckPlate || 'Chưa phân' },
      { label: 'Lệnh giấy', value: value.paperOrderState === 'COMPLETED' ? 'Đã bàn giao' : value.paperOrderState === 'IN_PROGRESS' ? 'Sẵn sàng bàn giao' : 'Chưa đổi lệnh xong' },
      { label: 'Chi phí / chứng từ', value: value.expenseEvidenceComplete ? 'Đủ' : 'Còn thiếu' },
    ];
  }
  if (role === 'driver') {
    const value = item as DriverWorkInboxItem;
    return [
      { label: 'Lô hàng', value: value.shipmentCode || 'Chưa có mã' },
      { label: 'Container', value: value.containerSummary || 'Không áp dụng' },
      { label: 'Điểm đi', value: value.origin || 'Chưa cập nhật' },
      { label: 'Điểm đến', value: value.destination || 'Chưa cập nhật' },
      { label: 'Liên hệ', value: [value.contactName, value.contactPhone].filter(Boolean).join(' · ') || 'Chưa cập nhật' },
      { label: 'POD', value: value.podState === 'ACCEPTED' ? 'Đã duyệt' : value.podState === 'SUBMITTED' ? 'Chờ duyệt' : value.podState === 'REJECTED' ? 'Cần bổ sung' : value.podState === 'DRAFT' ? 'Bản nháp' : 'Chưa nộp' },
    ];
  }
  const value = item as CustomerWorkInboxItem;
  return [
    { label: 'Container', value: value.containerSummary || 'Không áp dụng' },
    { label: 'Nguồn trạng thái', value: value.deliveryTruth === 'DRIVER_REPORTED' ? 'Tài xế báo đã giao' : value.deliveryTruth === 'POD_ACCEPTED' ? 'POD đã được chấp nhận' : value.deliveryTruth === 'IN_TRANSIT' ? 'Đang vận chuyển' : 'Chưa có báo cáo giao hàng' },
  ];
}

export function RoleWorkInbox({ role, title, description, customerId, scopeReady = true }: Props) {
  const auth = useAuth();
  const user = auth?.user ?? null;
  const navigate = useNavigate();
  const [data, setData] = useState<InboxData | null>(null);
  const [active, setActive] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [refreshError, setRefreshError] = useState(false);
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine);
  const [respondingItemId, setRespondingItemId] = useState<string | null>(null);
  const [disputeItemId, setDisputeItemId] = useState<string | null>(null);
  const [disputeReason, setDisputeReason] = useState('');
  const [responseMessage, setResponseMessage] = useState<{ kind: 'success' | 'error' | 'conflict'; text: string } | null>(null);
  const responseKeys = useRef(new Map<string, string>());
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const latestLoadRequest = useRef(0);
  const replayAttemptedIds = useRef('');
  const { commands, enqueue, drain } = useOfflineCommandQueue({
    maxPending: 12,
    storageScope: role !== 'customer' && user ? `${user.role}:${user.userId}` : null,
  });
  const endpoint = endpointFor(role, customerId, states[active], page);

  const load = useCallback(async (mode: 'initial' | 'refresh' = 'refresh') => {
    if (role === 'customer' && !scopeReady) return;
    const requestId = latestLoadRequest.current + 1;
    latestLoadRequest.current = requestId;
    if (mode === 'initial') setLoading(true);
    setRefreshError(false);
    try {
      const nextData = await api.get<InboxData>(endpoint);
      if (requestId !== latestLoadRequest.current) return;
      setData(nextData);
    } catch {
      if (requestId !== latestLoadRequest.current) return;
      setRefreshError(true);
    } finally {
      if (requestId === latestLoadRequest.current) setLoading(false);
    }
  }, [endpoint, role, scopeReady]);

  useEffect(() => {
    setData(null);
    setResponseMessage(null);
    void load('initial');
  }, [load]);

  useEffect(() => {
    setActive(0);
    setPage(1);
  }, [customerId, role]);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  const items = data?.items ?? [];
  const stale = data ? Date.now() - new Date(data.asOf).getTime() > STALE_AFTER_MS : false;
  const panelId = `role-inbox-panel-${role}`;
  const replayableCommandIds = useMemo(() => commands
    .filter((command) => (command.status === 'QUEUED' || command.status === 'FAILED') && (role === 'driver' ? command.endpoint.startsWith('driver.') : role === 'operations' ? command.endpoint.startsWith('forwarder.') : false))
    .map((command) => command.id)
    .sort()
    .join('|'), [commands, role]);

  useEffect(() => {
    if (!online) {
      replayAttemptedIds.current = '';
      return;
    }
    if (role === 'customer' || !replayableCommandIds || replayAttemptedIds.current === replayableCommandIds) return;
    replayAttemptedIds.current = replayableCommandIds;
    void drain(sendRoleOfflineCommand).then((result) => {
      replayAttemptedIds.current = Object.entries(result.statusById)
        .filter(([, status]) => status === 'QUEUED' || status === 'FAILED')
        .map(([id]) => id)
        .sort()
        .join('|');
      if (result.done > 0) void load();
    });
  }, [drain, load, online, replayableCommandIds, role]);

  const selectTab = (index: number) => {
    setActive(index);
    setPage(1);
  };

  const handleTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next = index;
    if (event.key === 'ArrowRight') next = (index + 1) % labels[role].length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + labels[role].length) % labels[role].length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = labels[role].length - 1;
    else return;
    event.preventDefault();
    selectTab(next);
    window.requestAnimationFrame(() => tabRefs.current[next]?.focus());
  };

  const sendOrderExchange = async (item: OperationsWorkInboxItem) => {
    if (item.orderExchangeState === 'COMPLETED') return;
    const action = item.orderExchangeState === 'PENDING' ? 'start' : 'complete';
    const idempotencyKey = buildOfflineCommandKey('forwarder', 'order-exchange', item.shipmentId, action, 'version', item.shipmentVersion);
    setRespondingItemId(item.id);
    setResponseMessage(null);
    enqueue({
      id: idempotencyKey,
      endpoint: `forwarder.order-exchange.${action}`,
      method: 'POST',
      path: `/forwarder/me/shipments/${item.shipmentId}/order-exchange/${action}`,
      fulfillmentScopeKey: `shipment:${item.shipmentId}`,
      expectedVersion: item.shipmentVersion,
      actionKind: action === 'start' ? 'ORDER_EXCHANGE_START' : 'ORDER_EXCHANGE_COMPLETE',
      payload: { kind: `order-exchange-${action}`, shipmentId: item.shipmentId, expectedVersion: item.shipmentVersion },
    });
    replayAttemptedIds.current = [...new Set([...replayableCommandIds.split('|').filter(Boolean), idempotencyKey])].sort().join('|');
    const result = await drain(sendRoleOfflineCommand);
    const status = result.statusById[idempotencyKey];
    if (status === 'DONE') {
      setResponseMessage({ kind: 'success', text: action === 'start' ? 'Máy chủ đã xác nhận bắt đầu đổi lệnh.' : 'Máy chủ đã xác nhận hoàn tất đổi lệnh.' });
      await load();
    } else if (status === 'CONFLICT') {
      setResponseMessage({ kind: 'conflict', text: result.messageById[idempotencyKey] ?? 'Lô hàng đã thay đổi. Bản lệnh vẫn được giữ để kiểm tra.' });
    } else if (status === 'REJECTED') {
      setResponseMessage({ kind: 'error', text: result.messageById[idempotencyKey] ?? 'Máy chủ từ chối lệnh. Bản lệnh vẫn được giữ để kiểm tra.' });
    } else {
      setResponseMessage({ kind: 'error', text: 'Đã lưu lệnh ngoại tuyến; chưa được xem là hoàn tất.' });
    }
    setRespondingItemId(null);
  };

  const sendCustomerResponse = async (item: CustomerWorkInboxItem, decision: 'CONFIRMED' | 'DISPUTED') => {
    if (!item.deliveryEventId || !item.deliveryEventVersion) return;
    const reason = decision === 'DISPUTED' ? disputeReason.trim() : undefined;
    if (decision === 'DISPUTED' && !reason) {
      setResponseMessage({ kind: 'error', text: 'Vui lòng nêu lý do sai lệch.' });
      return;
    }
    const keyName = `${item.deliveryEventId}:${decision}`;
    let idempotencyKey = responseKeys.current.get(keyName);
    if (!idempotencyKey) {
      idempotencyKey = crypto.randomUUID();
      responseKeys.current.set(keyName, idempotencyKey);
    }
    setRespondingItemId(item.id);
    setResponseMessage(null);
    try {
      await api.post(
        withCustomerScope(PORTAL.DELIVERY_RESPONSE(item.shipmentId, item.deliveryEventId), customerId ?? null),
        { expectedVersion: item.deliveryEventVersion, decision, reason },
        { idempotencyKey },
      );
      responseKeys.current.delete(keyName);
      setDisputeItemId(null);
      setDisputeReason('');
      setResponseMessage({ kind: 'success', text: decision === 'CONFIRMED' ? 'Đã đồng bộ xác nhận nhận hàng.' : 'Đã đồng bộ báo cáo sai lệch.' });
      await load();
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        setResponseMessage({ kind: 'conflict', text: 'Phản hồi đang xung đột với phiên bản mới. Dữ liệu nháp vẫn được giữ; hãy tải lại trước khi gửi.' });
      } else {
        setResponseMessage({ kind: 'error', text: error instanceof Error ? error.message : 'Không thể gửi phản hồi.' });
      }
    } finally {
      setRespondingItemId(null);
    }
  };

  return (
    <main className="role-work-inbox">
      <header className="role-work-inbox__header">
        <div>
          <span className="role-work-inbox__eyebrow">Không gian công việc</span>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
        <button className="role-work-inbox__refresh" type="button" onClick={() => void load()} disabled={loading}>
          <RefreshCw size={15} aria-hidden="true" /> Làm mới
        </button>
      </header>

      {!online && (
        <div className="role-work-inbox__notice" role="status">
          <CloudOff size={16} aria-hidden="true" /> Đang ngoại tuyến. Lệnh Vận hành và Tài xế chỉ hiển thị hoàn tất sau khi máy chủ xác nhận.
        </div>
      )}
      {refreshError && data && (
        <div className="role-work-inbox__notice is-warning" role="alert">
          <AlertTriangle size={16} aria-hidden="true" /> Không thể làm mới; đang hiển thị dữ liệu gần nhất.
        </div>
      )}
      {stale && (
        <div className="role-work-inbox__notice is-warning" role="status">
          <Clock3 size={16} aria-hidden="true" /> Dữ liệu đã cũ. Hãy làm mới trước khi xử lý.
        </div>
      )}
      {responseMessage && (
        <div className={`role-work-inbox__notice is-${responseMessage.kind}`} role={responseMessage.kind === 'success' ? 'status' : 'alert'}>
          {responseMessage.kind === 'success' ? <CheckCircle2 size={16} aria-hidden="true" /> : <AlertTriangle size={16} aria-hidden="true" />}
          {responseMessage.text}
        </div>
      )}

      <div className="role-work-inbox__tabs" role="tablist" aria-label="Trạng thái công việc">
        {labels[role].map((label, index) => (
          <button
            key={label}
            id={`role-inbox-tab-${role}-${index}`}
            type="button"
            role="tab"
            aria-selected={active === index}
            aria-controls={panelId}
            tabIndex={active === index ? 0 : -1}
            className={active === index ? 'is-active' : ''}
            ref={(element) => { tabRefs.current[index] = element; }}
            onClick={() => selectTab(index)}
            onKeyDown={(event) => handleTabKeyDown(event, index)}
          >
            {label}<span>{data?.counts?.[countKeys[index]] ?? 0}</span>
          </button>
        ))}
      </div>

      <section id={panelId} role="tabpanel" aria-labelledby={`role-inbox-tab-${role}-${active}`}>
        {loading && !data ? (
          <div className="role-work-inbox__state" role="status"><Loader2 className="spin" /> Đang tải công việc…</div>
        ) : refreshError && !data ? (
          <div className="role-work-inbox__state is-error" role="alert">
            <AlertTriangle /> Không thể tải công việc.
            <button type="button" onClick={() => void load('initial')}><RefreshCw size={15} /> Thử lại</button>
          </div>
        ) : items.length === 0 ? (
          <div className="role-work-inbox__state"><CheckCircle2 /> Không có việc trong nhóm này.</div>
        ) : (
          <div className="role-work-inbox__table-wrap">
            <table className="role-work-inbox__table">
              <thead>
                <tr><th>Công việc</th><th>Thông tin cần biết</th><th>Mốc nghiệp vụ</th><th>Trạng thái</th><th>Trở ngại</th><th>Cập nhật</th><th><span className="sr-only">Hành động</span></th></tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const customerItem = role === 'customer' ? item as CustomerWorkInboxItem : null;
                  const operationsItem = role === 'operations' ? item as OperationsWorkInboxItem : null;
                  const customerAction = Boolean(customerItem?.deliveryResponseRequired && customerItem.deliveryEventId && customerItem.deliveryEventVersion);
                  const orderExchangeAction = Boolean(operationsItem && operationsItem.orderExchangeState !== 'COMPLETED');
                  const rowTarget = item.nextAction?.targetRoute ?? item.targetRoute;
                  const handleRowActivate = (event: React.MouseEvent<HTMLTableRowElement> | React.KeyboardEvent<HTMLTableRowElement>) => {
                    // Don't navigate when the user clicked an inner button/link/textarea —
                    // those have their own handlers and must take precedence.
                    const target = event.target as HTMLElement;
                    if (target.closest('a, button, textarea, input, label')) return;
                    navigate(rowTarget);
                  };
                  return (
                    <tr
                      key={item.id}
                      className={item.priority >= 80 ? 'is-priority' : ''}
                      role="link"
                      tabIndex={0}
                      aria-label={`Mở hồ sơ ${item.title}`}
                      onClick={handleRowActivate}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          handleRowActivate(event);
                        }
                      }}
                    >
                      <td data-label="Công việc">
                        <strong className="role-work-inbox__identity">{item.title}</strong>
                        {item.subtitle && <span className="role-work-inbox__subtitle">{item.subtitle}</span>}
                      </td>
                      <td data-label="Thông tin">
                        <dl className="role-work-inbox__facts">
                          {factsFor(item, role).map((fact) => <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}
                        </dl>
                      </td>
                      <td data-label="Mốc nghiệp vụ">
                        {role !== 'customer' && (
                          <ul className="role-work-inbox__gate" aria-label="Mốc nghiệp vụ O2C">
                            {crossBranchGate(item, role).map((gate) => (
                              <li key={gate.label} className={gate.satisfied ? 'is-ok' : 'is-pending'}>
                                <span className="role-work-inbox__gate-label">{gate.label}</span>
                                <span className="role-work-inbox__gate-mark" aria-hidden="true">{gate.satisfied ? '✓' : '…'}</span>
                                {!gate.satisfied && gate.pending && <span className="role-work-inbox__gate-pending">{gate.pending}</span>}
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                      <td data-label="Trạng thái"><span className={`role-work-inbox__badge is-${item.state.toLowerCase()}`}>{statusLabel(item)}</span></td>
                      <td data-label="Trở ngại">
                        {item.blockers.length > 0 ? <span className="role-work-inbox__blocker">{item.blockers[0].label}<small>Chủ trì: {item.blockers[0].ownerLabel}</small></span>
                          : item.advisories.length > 0 ? <span className="role-work-inbox__advisory">{item.advisories[0].label}</span>
                            : <span className="role-work-inbox__muted">Không có</span>}
                      </td>
                      <td data-label="Cập nhật"><time dateTime={item.freshnessAt}>{formatTime(item.freshnessAt)}</time></td>
                      <td data-label="Hành động" className="role-work-inbox__action">
                        {orderExchangeAction && operationsItem ? (
                          <button type="button" className="role-work-inbox__button is-primary" disabled={respondingItemId === item.id} onClick={() => void sendOrderExchange(operationsItem)}>{operationsItem.orderExchangeState === 'PENDING' ? 'Bắt đầu đổi lệnh' : 'Xác nhận đã đổi lệnh'}</button>
                        ) : customerAction && customerItem ? (
                          <div className="role-work-inbox__customer-actions">
                            <button type="button" className="role-work-inbox__button is-primary" disabled={respondingItemId === item.id} onClick={() => void sendCustomerResponse(customerItem, 'CONFIRMED')}>Xác nhận đã nhận hàng</button>
                            {disputeItemId === item.id ? (
                              <div className="role-work-inbox__dispute">
                                <label htmlFor={`dispute-${item.id}`}>Lý do sai lệch</label>
                                <textarea id={`dispute-${item.id}`} value={disputeReason} onChange={(event) => setDisputeReason(event.target.value)} maxLength={1000} autoFocus />
                                <div><button type="button" className="role-work-inbox__button is-danger" disabled={respondingItemId === item.id} onClick={() => void sendCustomerResponse(customerItem, 'DISPUTED')}>Gửi báo sai lệch</button><button type="button" className="role-work-inbox__button" onClick={() => setDisputeItemId(null)}>Hủy</button></div>
                              </div>
                            ) : <button type="button" className="role-work-inbox__button" onClick={() => { setDisputeItemId(item.id); setDisputeReason(''); }}>Báo sai lệch</button>}
                          </div>
                        ) : item.nextAction ? (
                          <Link className="role-work-inbox__button" to={item.nextAction.targetRoute}>{item.nextAction.label}</Link>
                        ) : <Link className="role-work-inbox__detail-link" to={item.targetRoute}>Xem hồ sơ</Link>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {data && data.totalPages > 1 && (
          <nav className="role-work-inbox__pagination" aria-label="Phân trang công việc">
            <button type="button" disabled={page <= 1 || loading} onClick={() => setPage((value) => Math.max(1, value - 1))}>Trang trước</button>
            <span>Trang {data.page.toLocaleString('vi-VN')} / {data.totalPages.toLocaleString('vi-VN')} · {data.total.toLocaleString('vi-VN')} việc</span>
            <button type="button" disabled={page >= data.totalPages || loading} onClick={() => setPage((value) => value + 1)}>Trang sau</button>
          </nav>
        )}
      </section>
    </main>
  );
}
