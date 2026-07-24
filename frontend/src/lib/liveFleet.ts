import L from 'leaflet';
import type { LiveFleetStatus } from '@tingting/shared';

/** Shared live-fleet marker styling — used by both the Dispatch map and the
 *  trip-detail route map so markers look identical everywhere. */

export const LIVE_STATUS_COLOR: Record<LiveFleetStatus, string> = {
  moving: '#00B14F',
  stopped: '#F59E0B',
  offline: '#94A3B8',
};

export const LIVE_STATUS_LABEL: Record<LiveFleetStatus, string> = {
  moving: 'Đang chạy',
  stopped: 'Dừng',
  offline: 'Mất tín hiệu',
};

/**
 * Escape a string for safe interpolation into an HTML string (Leaflet
 * bindPopup / divIcon render their `html` via innerHTML). GPS fields such as
 * the device address/driver-name arrive from the vendor unescaped, and trip
 * customer/route names are free-text — escape every interpolated text value.
 */
export function escapeHtml(s: string | null | undefined): string {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** A colored dot with an optional heading arrow (shown only when moving). */
export function liveMarkerIcon(status: LiveFleetStatus, angle = 0): L.DivIcon {
  const color = LIVE_STATUS_COLOR[status];
  const arrow =
    status === 'moving'
      ? `<div style="position:absolute; top:50%; left:50%; width:0; height:0; transform: translate(-50%,-50%) rotate(${angle}deg);">
           <div style="position:absolute; top:-16px; left:-5px; width:0; height:0;
             border-left:5px solid transparent; border-right:5px solid transparent;
             border-bottom:9px solid ${color};"></div>
         </div>`
      : '';
  return L.divIcon({
    className: 'custom-map-marker',
    html: `<div style="position:relative; width:28px; height:28px;">
        ${arrow}
        <div style="position:absolute; top:50%; left:50%; transform: translate(-50%,-50%);
          width:20px; height:20px; background:${color}; border:2px solid #FFFFFF; border-radius:50%;
          box-shadow:0 0 8px ${color}99;"></div>
      </div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -16],
  });
}
