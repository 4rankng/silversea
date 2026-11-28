// SIL-717 (id 837) — the CUS Tổng quan drawer's "Thêm container" section.
//
// The section owns the trigger, the caption and the form; the law (which row
// is copied, and which two fields never are) lives in
// `../containerCopyLaw`, and the form itself is the shared
// `../ContainerAddForm`.
//
// The SOURCE ROW is resolved by the HOST (the page) and handed down, so the
// caption the operator reads and the wire body the page sends can never name
// different rows.

import { useState } from 'react';
import { Plus } from 'lucide-react';
import type {
  ShipmentCusWorkspaceContainerLine,
  ShipmentCusWorkspaceDetail,
} from '@tingting/shared';
import { formatTimeShortDate } from '../../../lib/shipment-operations';
import { ContainerAddForm, type ContainerAddEntry } from '../ContainerAddForm';
import { cusContainerAddCopy } from './cusContainerAdd';

const dash = '—';

export interface CusContainerAddSectionProps {
  /** The row the new container copies — the sheet's LAST row. */
  source: ShipmentCusWorkspaceContainerLine | null;
  /** The lot detail — the master's site catalog for the caption. */
  detail?: ShipmentCusWorkspaceDetail;
  /** The host's write — resolves true once the row landed. */
  onAdd: (entry: ContainerAddEntry) => Promise<boolean>;
  /** SIL-1144 (KB §10.6.7): the Tờ khai hải quan register reuses this whole
   *  add flow (open/saving/error + the copy law) but names its trigger for
   *  the register's verb — a declaration slot IS a new container row. */
  triggerLabel?: string;
  triggerAriaLabel?: string;
}

/** The nhà máy of a row, by the lot's own site catalog. */
function siteLabel(detail: ShipmentCusWorkspaceDetail | undefined, siteId: number | null): string {
  if (siteId == null || !detail) return dash;
  return detail.selectors.operationalSites.find((site) => site.id === siteId)?.name ?? dash;
}

export function CusContainerAddSection({ source, detail, onAdd, triggerLabel = 'Thêm container', triggerAriaLabel }: CusContainerAddSectionProps) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const copy = cusContainerAddCopy(source);
  const copySummary = source
    ? [
      `Copy từ container ${source.ordinal}`,
      siteLabel(detail, source.operationalSiteId),
      source.routeName,
      source.liftSite,
      source.dropoffSite,
      source.customerAppointmentAt ? formatTimeShortDate(source.customerAppointmentAt) : null,
      source.raw.cargoVolumeCbm ? `${source.raw.cargoVolumeCbm} CBM` : null,
    ]
      // The dash is the house's "missing" mark; inside a sentence it reads as
      // noise, so an absent field simply does not ride the caption.
      .filter((part): part is string => Boolean(part) && part !== dash)
      .join(' · ')
    : 'Lô chưa có container nào để copy — dòng mới để trống.';

  return (
    <div className="cus-lot-add">
      {open ? (
        <ContainerAddForm
          copy={copy}
          containerTypes={detail?.selectors.containerTypes ?? []}
          copySummary={copySummary}
          saving={saving}
          error={error}
          onCancel={() => { setOpen(false); setError(null); }}
          onSubmit={(entry) => {
            setSaving(true);
            setError(null);
            void (async () => {
              try {
                // The write THROWS on failure (the hook owns the message), so
                // the form stays open with the reason — never a silent no-op.
                const ok = await onAdd(entry);
                if (ok) setOpen(false);
              } catch (cause) {
                setError(cause instanceof Error && cause.message.trim()
                  ? cause.message
                  : 'Không thêm được container. Vui lòng thử lại.');
              } finally {
                setSaving(false);
              }
            })();
          }}
        />
      ) : (
        <button
          type="button"
          className="cus-lot-add__trigger"
          aria-label={triggerAriaLabel}
          onClick={() => { setOpen(true); setError(null); }}
        >
          <Plus size={16} aria-hidden="true" />
          {triggerLabel}
        </button>
      )}
    </div>
  );
}
