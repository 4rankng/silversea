import { ExternalLink } from 'lucide-react';
import type { OperationalSite } from '../../api/shipmentClient';
import { Modal } from '../UI';

interface OperationalSiteDetailsDialogProps {
  site: OperationalSite | null;
  isOpen: boolean;
  onClose: () => void;
}

function DetailRow({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div style={{ display: 'grid', gap: 4 }}>
      <span style={{ color: 'var(--fg-3)', fontSize: 'var(--text-caption-size)', fontWeight: 700, textTransform: 'uppercase' }}>
        {label}
      </span>
      <span style={{ color: 'var(--fg-1)', lineHeight: 1.55, overflowWrap: 'anywhere' }}>{value}</span>
    </div>
  );
}

export function OperationalSiteDetailsDialog({ site, isOpen, onClose }: OperationalSiteDetailsDialogProps) {
  return (
    <Modal isOpen={isOpen && Boolean(site)} title={site ? (site.shortName || site.name) : 'Thông tin nhà máy'} onClose={onClose} maxWidth={640}>
      {site && (
        <div style={{ display: 'grid', gap: 18 }}>
          <DetailRow label="Tên đầy đủ" value={site.name} />
          <DetailRow label="Địa chỉ" value={site.address} />
          {site.googleMapsUrl && (
            <a
              href={site.googleMapsUrl}
              target="_blank"
              rel="noreferrer"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minHeight: 44, color: 'var(--accent, #2563eb)', fontWeight: 600 }}
            >
              <ExternalLink size={17} aria-hidden="true" /> Mở vị trí trên Google Maps
            </a>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 16 }}>
            <DetailRow label="Người liên hệ" value={site.contactName} />
            <DetailRow label="Số điện thoại" value={site.contactPhone} />
            <DetailRow label="Đơn vị xuất hóa đơn nâng hạ" value={site.liftFeeInvoiceName} />
            <DetailRow label="Mã số thuế" value={site.liftFeeTaxCode} />
          </div>
          <DetailRow label="Địa chỉ xuất hóa đơn" value={site.liftFeeInvoiceAddress} />
          <div style={{ borderLeft: '4px solid var(--warning, #d97706)', background: 'var(--warning-bg, #fff7ed)', padding: 14, borderRadius: 6 }}>
            <DetailRow label="Quy định và lưu ý của kho" value={site.strictRules || 'Chưa có lưu ý riêng.'} />
          </div>
        </div>
      )}
    </Modal>
  );
}
