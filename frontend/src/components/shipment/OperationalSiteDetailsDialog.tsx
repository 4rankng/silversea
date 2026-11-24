import { ExternalLink } from 'lucide-react';
import type { OperationalSite } from '../../api/shipmentClient';
import { Modal } from '../UI';
import { TelLink } from '../TelLink';
import './OperationalSiteDetailsDialog.css';

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
function DetailRow({ label, value, span, tel }: { label: string; value: string | null; span?: boolean; tel?: boolean }) {
  if (!value) return null;
  return (
    <div style={{ display: 'grid', gap: 1, ...(span ? { gridColumn: '1 / -1' } : {}) }}>
      <span style={{ color: 'var(--fg-3)', fontSize: 'var(--text-caption-size)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.02em' }}>
        {label}
      </span>
      {/* DRI-01 (card 211026130743): the site phone is the tap-to-call tel:
          link through the shared house pattern, not dead text. */}
      <span style={{ color: 'var(--fg-1)', fontSize: 'var(--text-data-size)', lineHeight: 1.45, overflowWrap: 'anywhere' }}>
        {tel ? <TelLink phone={value} className="site-detail-phone--tel" /> : value}
      </span>
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
          <DetailRow label="Số điện thoại" value={site.contactPhone} tel />
          {/* SIL-941 (CUS-07, §7.2.1 K7.7): the dialog must open the site's
              INVOICE identity (MST, tên xuất hóa đơn, địa chỉ xuất hóa đơn) —
              not only the address + warehouse rules QA (staging 3e9a28fa)
              found. The block always renders and names the gap honestly
              (K2.98) instead of silently vanishing like an empty row. */}
          <div style={{ gridColumn: '1 / -1', display: 'grid', gap: 1, paddingTop: 2 }}>
            <span style={{ color: 'var(--fg-3)', fontSize: 'var(--text-caption-size)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.02em' }}>
              Thông tin xuất hóa đơn
            </span>
            {site.invoiceTaxCode || site.invoiceName || site.invoiceAddress ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '8px 14px' }}>
                <DetailRow label="MST" value={site.invoiceTaxCode} />
                <DetailRow label="Tên xuất hóa đơn" value={site.invoiceName} />
                <DetailRow label="Địa chỉ xuất hóa đơn" value={site.invoiceAddress} span />
              </div>
            ) : (
              <p style={{ color: 'var(--fg-2)', fontSize: 'var(--text-data-size)', lineHeight: 1.45, margin: 0 }}>
                Nhà máy chưa cấu hình thông tin xuất hóa đơn.
              </p>
            )}
          </div>
          {/* The lift-fee invoice unit is a DIFFERENT entity (the party billing
              the nâng/hạ fee) — its rows carry that subject in every label so
              they never collide with the factory's own invoice block above. */}
          <DetailRow label="Mã số thuế ĐV nâng hạ" value={site.liftFeeTaxCode} />
          <DetailRow label="Đơn vị xuất hóa đơn nâng hạ" value={site.liftFeeInvoiceName} span />
          <DetailRow label="Địa chỉ ĐV nâng hạ" value={site.liftFeeInvoiceAddress} span />
          <div style={{ gridColumn: '1 / -1', borderLeft: '4px solid var(--warning, #d97706)', background: 'var(--warning-bg, #fff7ed)', padding: 10, borderRadius: 6 }}>
            <DetailRow label="Quy định và lưu ý của kho" value={site.strictRules || 'Chưa có lưu ý riêng.'} span />
          </div>
        </div>
      )}
    </Modal>
  );
}
