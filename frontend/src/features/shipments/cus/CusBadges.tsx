import {
  AlertTriangle,
  CalendarClock,
  CircleCheck,
  CircleDollarSign,
  FileLock2,
  Truck,
} from 'lucide-react';
import {
  SHIPMENT_STATUS_LABELS,
  ShipmentCusBucket,
  type ShipmentCusWorkspaceListItem,
} from '@tingting/shared';
import { formatMoney } from '../../../lib/format';
import { accountingConfirmationLabel, deriveShipmentSignals } from './cusUtils';

export function FinanceEvidence({ item }: { item: ShipmentCusWorkspaceListItem }) {
  const confirmationIsCurrent = item.accountingConfirmation.status === 'CONFIRMED';
  const revenue = Number(item.finance.customerInvoiceTotal ?? 0) + Number(item.finance.customerNoInvoiceTotal ?? 0);
  const cost = Number(item.finance.totalCost ?? 0);
  const lossAmount = item.finance.isLoss ? Math.max(0, cost - revenue) : 0;
  const reconciliationLabel = item.finance.isLoss
    ? `Lỗ ${formatMoney(String(lossAmount))} ₫`
    : item.finance.customerChargeTotalsAvailable
      ? 'Không ghi nhận lỗ'
      : 'Chưa đủ số liệu đối soát';
  return (
    <div className="cus-finance-evidence">
      <div className={item.finance.isLoss ? 'cus-finance-loss' : 'cus-finance-quiet'}>
        {item.finance.isLoss
          ? <AlertTriangle size={16} aria-hidden="true" />
          : <CircleDollarSign size={16} aria-hidden="true" />}
        <span><small>Đối soát chi phí</small><strong>{reconciliationLabel}</strong></span>
      </div>
      <div className={`cus-finance-confirmation cus-finance-confirmation--${confirmationIsCurrent ? 'confirmed' : 'attention'}`}>
        {confirmationIsCurrent
          ? <CircleCheck size={16} aria-hidden="true" />
          : <AlertTriangle size={16} aria-hidden="true" />}
        <span><small>Đối soát tài chính</small><strong>{accountingConfirmationLabel(item.accountingConfirmation)}</strong></span>
      </div>
    </div>
  );
}

const BUCKET_ICONS = {
  [ShipmentCusBucket.NEW]: CalendarClock,
  [ShipmentCusBucket.RUNNING]: Truck,
  [ShipmentCusBucket.PENDING_LOCK]: FileLock2,
  [ShipmentCusBucket.LOCKED]: CircleCheck,
};

export function WorkflowBadge({ item }: { item: ShipmentCusWorkspaceListItem }) {
  const Icon = BUCKET_ICONS[item.bucket];
  // PENDING_LOCK groups completed operational work awaiting accounting
  // finalization; show its actual state instead of the generic bucket label.
  // Driver full-closed shipments are LOCKED (locked
  // tab) even before an accounting lock row exists; that tab keeps the
  // bucket label because it groups heterogeneous sub-states (an active
  // accounting lock and the unlocked full-closed aggregate).
  const useStatusLabel = item.bucket === ShipmentCusBucket.NEW
    || item.bucket === ShipmentCusBucket.PENDING_LOCK;
  const label = useStatusLabel ? SHIPMENT_STATUS_LABELS[item.status] : item.bucketLabel;
  return (
    <span className={`cus-workflow-badge cus-workflow-badge--${item.bucket.toLowerCase()}`}>
      <Icon size={14} aria-hidden="true" /> {label}
    </span>
  );
}

export function ShipmentSignals({ item }: { item: ShipmentCusWorkspaceListItem }) {
  const signals = deriveShipmentSignals(item);
  if (signals.length === 0) return null;
  return (
    <div className="cus-signals" aria-label="Ngoại lệ cần xử lý">
      {signals.map((signal) => {
        const Icon = signal.icon;
        return (
          <span key={signal.key} className={`cus-signal cus-signal--${signal.tone}`}>
            <Icon size={14} aria-hidden="true" /> {signal.label}
          </span>
        );
      })}
    </div>
  );
}
