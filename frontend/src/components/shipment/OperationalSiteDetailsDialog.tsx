import { ExternalLink } from 'lucide-react';
import type { OperationalSite } from '../../api/shipmentClient';
import { Modal } from '../UI';

interface OperationalSiteDetailsDialogProps {
  site: OperationalSite | null;
  isOpen: boolean;
  onClose: () => void;
}

/* Dense fact grid — the owner density principle (11/10 report: "a message,
 * not data dense"). Consulted Untitled UI PRO application/modals family
 * (stacked-left-aligned-modal, access-request-modal): label-over-value
 * cells on a tight grid, helpers at caption size. Inline-style idiom kept
 * to match the file's history. */
function DetailRow({ label, value, span }: { label: string; value: string | null; span?: boolean }) {
  if (!value) return null;
  return (
    <div style={{ display: 'grid', gap: 1, ...(span ? { gridColumn: '1 / -1' } : {}) }}>
      <span style={{ color: 'var(--fg-3)', fontSize: 'var(--text-caption-size)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.02em' }}>
        {label}
      </span>
      <span style={{ color: 'var(--fg-1)', fontSize: 'var(--text-data-size)', lineHeight: 1.45, overflowWrap: 'anywhere' }}>{value}</span>
    </div>
  );
}

export function OperationalSiteDetailsDialog({ site, isOpen, onClose }: OperationalSiteDetailsDialogProps) {
  return (
    <Modal isOpen={isOpen && Boolean(site)} title={site ? (site.shortName || site.name) : 'Thông tin nhà máy'} onClose={onClose} maxWidth={640}>
      {site && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '8px 14px' }}>
          <DetailRow label="Tên đầy đủ" value={site.name} span={site.googleMapsUrl ? undefined : true} />
          {site.googleMapsUrl && (
            <div style={{ display: 'flex', alignItems: 'flex-end', gridColumn: '2 / -1' }}>
              <a
                href={site.googleMapsUrl}
                target="_blank"
                rel="noreferrer"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 'var(--control-touch-h)', color: 'var(--accent-ink, #00361B)', fontWeight: 600, fontSize: 'var(--text-data-size)' }}
              >
                <ExternalLink size={15} aria-hidden="true" style={{ color: 'var(--accent, #2563eb)' }} /> Mở vị trí trên Google Maps
              </a>
            </div>
          )}
          <DetailRow label="Địa chỉ" value={site.address} span />
          <DetailRow label="Người liên hệ" value={site.contactName} />
          <DetailRow label="Số điện thoại" value={site.contactPhone} />
          <DetailRow label="Mã số thuế" value={site.liftFeeTaxCode} />
          <DetailRow label="Đơn vị xuất hóa đơn nâng hạ" value={site.liftFeeInvoiceName} span />
          <DetailRow label="Địa chỉ xuất hóa đơn" value={site.liftFeeInvoiceAddress} span />
          <div style={{ gridColumn: '1 / -1', borderLeft: '4px solid var(--warning, #d97706)', background: 'var(--warning-bg, #fff7ed)', padding: 10, borderRadius: 6 }}>
            <DetailRow label="Quy định và lưu ý của kho" value={site.strictRules || 'Chưa có lưu ý riêng.'} span />
          </div>
        </div>
      )}
    </Modal>
  );
}
