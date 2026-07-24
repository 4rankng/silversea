import { useEffect, useRef } from 'react';
import L from 'leaflet';
import type { LiveFleetVehicle } from '@tingting/shared';
import { LIVE_STATUS_COLOR, LIVE_STATUS_LABEL, liveMarkerIcon, escapeHtml } from '../../../lib/liveFleet';
import { formatDateTimeVN } from '../../../lib/format';
import './LiveFleetMap.css';

/**
 * Live fleet map (Dispatch page). One dot per truck — a live fix when available
 * (colored by status), otherwise the truck's last-known location (shown offline).
 * Each dot carries a permanent biển-số label and a click-popup with full detail.
 * Polled every ~25s; redraws each refresh, refits bounds only when the truck set
 * changes. Marker styling lives in lib/liveFleet.ts; leaflet.css is imported
 * globally in main.tsx, and the .fleet-plate-label style is imported locally at
 * the top of this module (Leaflet renders tooltips outside this subtree, but a
 * plain Vite CSS import still applies the class selector globally).
 */

interface LiveFleetMapProps {
  vehicles: LiveFleetVehicle[];
  height?: string;
}

function popupHtml(v: LiveFleetVehicle): string {
  const e = escapeHtml;
  const color = LIVE_STATUS_COLOR[v.status];
  const label = LIVE_STATUS_LABEL[v.status];
  const mono = "font-family:'JetBrains Mono', monospace;";
  const sans = "font-family:'Be Vietnam Pro', sans-serif;";
  return `<div style="min-width:210px; ${sans} font-size:13px; line-height:1.5;">
    <div style="display:flex; align-items:center; gap:8px; margin-bottom:6px;">
      <strong style="font-size:14px;">${e(v.licensePlate)}</strong>
      <span style="background:${color}22; color:${color}; padding:3px 8px; border-radius:999px; font-size:12px; line-height:1.35; font-weight:600;">${label}</span>
    </div>
    ${v.tripCode ? `<div>Mã chuyến: <span style="${mono}">${e(v.tripCode)}</span></div>` : ''}
    ${v.customerName ? `<div>Khách hàng: ${e(v.customerName)}</div>` : ''}
    ${v.routeName ? `<div>Tuyến: ${e(v.routeName)}</div>` : ''}
    <div>Tốc độ: <span style="${mono}">${Math.round(v.speed)} km/h</span> · ${v.ignitionOn ? 'động cơ bật' : 'động cơ tắt'}</div>
    ${v.driverName ? `<div>Lái xe: ${e(v.driverName)}</div>` : ''}
    ${v.address ? `<div style="color:#6B7280;">${e(v.address)}</div>` : ''}
    <div style="color:#9CA3AF; font-size:12px; line-height:1.35; margin-top:4px;">Cập nhật: ${formatDateTimeVN(v.lastSeenAt)}</div>
  </div>`;
}

export function LiveFleetMap({ vehicles, height = '380px' }: LiveFleetMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerGroupRef = useRef<L.LayerGroup | null>(null);
  // Refit bounds only when trucks enter/leave — not on every 25s refresh.
  const markerSetKeyRef = useRef<string>('');

  useEffect(() => {
    if (!containerRef.current) return;

    if (!mapRef.current) {
      const map = L.map(containerRef.current, {
        zoomControl: true,
        attributionControl: false,
      }).setView([16.047079, 108.206230], 6); // Centered on Vietnam
      L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
        maxZoom: 19,
      }).addTo(map);
      mapRef.current = map;
      layerGroupRef.current = L.layerGroup().addTo(map);
    }

    const map = mapRef.current;
    const layerGroup = layerGroupRef.current;
    if (!map || !layerGroup) return;

    // Clear + redraw each refresh: positions update, stale markers vanish.
    layerGroup.clearLayers();
    if (vehicles.length === 0) return;

    const truckMarkers: L.Marker[] = [];

    for (const v of vehicles) {
      const marker = L.marker([v.lat, v.lng], { icon: liveMarkerIcon(v.status, v.angle), zIndexOffset: 1000 })
        .addTo(layerGroup)
        // Permanent biển-số label so dispatch can tell trucks apart at a glance.
        .bindTooltip(v.licensePlate, {
          permanent: true,
          direction: 'right',
          className: 'fleet-plate-label',
          offset: [10, 0],
          interactive: true,
        })
        .bindPopup(popupHtml(v));

      const tooltip = marker.getTooltip();
      if (tooltip) {
        tooltip.on('click', () => marker.openPopup());
      }

      truckMarkers.push(marker);
    }

    const setKey = vehicles.map((v) => v.truckId).sort((a, b) => a - b).join(',');
    if (setKey !== markerSetKeyRef.current) {
      markerSetKeyRef.current = setKey;
      const all = truckMarkers;
      if (all.length > 0) {
        map.fitBounds(L.featureGroup(all).getBounds(), { padding: [50, 50], maxZoom: 13 });
      }
    }

    const timer = setTimeout(() => map.invalidateSize(), 100);
    return () => clearTimeout(timer);
  }, [vehicles]);

  // Clean up Leaflet on unmount
  useEffect(() => {
    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        layerGroupRef.current = null;
        markerSetKeyRef.current = '';
      }
    };
  }, []);

  return (
    <div
      style={{
        position: 'relative',
        zIndex: 1,
        width: '100%',
        height,
        borderRadius: 'var(--radius-lg, 12px)',
        overflow: 'hidden',
        border: '1px solid var(--border-2, #E5E7EB)',
      }}
    >
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
    </div>
  );
}
