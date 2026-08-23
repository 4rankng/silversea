import { useEffect, useRef } from 'react';
import L from 'leaflet';
// Leaflet's stylesheet rides the same chunks as this component (all of its
// consumers sit on lazy routes) instead of the eager entry bundle.
import 'leaflet/dist/leaflet.css';
import { decodePolyline } from '../../lib/maps';
import { LIVE_STATUS_LABEL, liveMarkerIcon } from '../../lib/liveFleet';
import type { GpsStop, LiveFleetStatus } from '@tingting/shared';

interface LeafletMapProps {
  polylinePath?: string | null;
  legs?: Array<{ origin: string; destination: string; polylinePath?: string | null; originCoord?: { lat: number; lng: number } | null; destinationCoord?: { lat: number; lng: number } | null }> | null;
  originName?: string;
  destinationName?: string;
  /** Live truck position to overlay on the route (trip-detail page). */
  livePosition?: { lat: number; lng: number; angle?: number; status: LiveFleetStatus; speed: number } | null;
  /** The vehicle's full real GPS trail (Bách Khoa) — the complete driven path,
   *  drawn as the real route with numbered markers at each real stop. */
  gpsTrail?: { encodedPolyline: string; stops?: GpsStop[] } | null;
  height?: string | number;
  className?: string;
}

export function LeafletMap({
  polylinePath,
  legs,
  originName = 'Điểm đi',
  destinationName = 'Điểm đến',
  livePosition = null,
  gpsTrail = null,
  height = '350px',
  className = '',
}: LeafletMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerGroupRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // Initialize map if it doesn't exist
    if (!mapRef.current) {
      const map = L.map(containerRef.current, {
        zoomControl: true,
        attributionControl: false,
      }).setView([16.047079, 108.206230], 6); // Centered on Vietnam

      // CartoDB Voyager — clean, readable light theme
      L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
        maxZoom: 19,
      }).addTo(map);

      mapRef.current = map;
      layerGroupRef.current = L.layerGroup().addTo(map);
    }

    const map = mapRef.current;
    const layerGroup = layerGroupRef.current;

    if (!map || !layerGroup) return;

    // Clear previous drawings
    layerGroup.clearLayers();

    const boundsLayers: L.Layer[] = [];

    // Full real GPS trail (Bách Khoa) — the complete driven path. Drawn FIRST so
    // the per-leg colored segments + numbered markers render on top of it.
    if (gpsTrail?.encodedPolyline) {
      const trailCoords = decodePolyline(gpsTrail.encodedPolyline);
      if (trailCoords.length >= 2) {
        boundsLayers.push(L.polyline(trailCoords, { color: '#0F172A', weight: 6, opacity: 0.5, lineJoin: 'round' }).addTo(layerGroup));
      }
    }

    const drawRoute = (
      polyline: string, color: string, startPopup: string, endPopup: string,
      opts: { startNumber?: number; withEnd?: boolean } = {},
    ) => {
      const coordinates = decodePolyline(polyline);
      if (coordinates.length === 0) return null;

      // Draw Polyline (real GPS trace from route_polylines — never Google routing)
      const routePolyline = L.polyline(coordinates, {
        color,
        weight: 4,
        opacity: 0.85,
        lineJoin: 'round',
      }).addTo(layerGroup);
      boundsLayers.push(routePolyline);

      // Start marker: a numbered circle in leg mode (1..N at each leg's
      // origin), otherwise the green dot for the single-polyline path.
      const startIcon = opts.startNumber != null
        ? L.divIcon({
            className: 'custom-map-marker',
            html: `<div style="width:28px;height:28px;border-radius:50%;background:${color};color:#fff;border:2px solid #fff;outline:1px solid rgba(16,24,20,0.28);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;line-height:1.35;">${opts.startNumber}</div>`,
            iconSize: [28, 28],
            iconAnchor: [14, 14],
          })
        : L.divIcon({
            className: 'custom-map-marker',
            html: `<div style="
              width: 20px;
              height: 20px;
              background: #10B981;
              border: 2px solid #FFFFFF;
              border-radius: 50%;
              outline: 2px solid rgba(16, 185, 129, 0.28);
            "></div>`,
            iconSize: [20, 20],
            iconAnchor: [10, 10],
          });
      L.marker(coordinates[0], { icon: startIcon, zIndexOffset: opts.startNumber != null ? 600 : 0 })
        .addTo(layerGroup)
        .bindPopup(startPopup);

      // End marker: only in single-polyline mode. In leg mode the numbered
      // origins of consecutive legs already mark each stop; the final
      // destination is just the polyline endpoint — no extra pin needed.
      if (opts.withEnd !== false) {
        const endIcon = L.divIcon({
          className: 'custom-map-marker',
          html: `<div style="
            width: 20px;
            height: 20px;
            background: #EF4444;
            border: 2px solid #FFFFFF;
            border-radius: 50%;
            outline: 2px solid rgba(239, 68, 68, 0.28);
          "></div>`,
          iconSize: [20, 20],
          iconAnchor: [10, 10],
        });
        L.marker(coordinates[coordinates.length - 1], { icon: endIcon })
          .addTo(layerGroup)
          .bindPopup(endPopup);
      }

      return routePolyline;
    };

    if (gpsTrail?.encodedPolyline && legs && legs.length > 0) {
      // Trip-detail (trail mode): the full GPS trail IS the route (navy, drawn
      // above). Place ONE numbered marker (1..N) at each leg's origin — the first
      // point of its GPS-derived route when available, otherwise the geocoded
      // originCoord, so EVERY leg is numbered even if its route wasn't captured.
      const colors = ['#10B981', '#06B6D4', '#3B82F6', '#8B5CF6'];
      legs.forEach((leg, index) => {
        let coord: { lat: number; lng: number } | null = null;
        if (leg.polylinePath) {
          const c = decodePolyline(leg.polylinePath);
          if (c.length) coord = { lat: c[0][0], lng: c[0][1] };
        }
        coord = coord ?? leg.originCoord ?? null;
        if (!coord) return;
        const color = colors[index % colors.length];
        const icon = L.divIcon({
          className: 'custom-map-marker',
          html: `<div style="width:28px;height:28px;border-radius:50%;background:${color};color:#fff;border:2px solid #fff;outline:1px solid rgba(16,24,20,0.28);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;line-height:1.35;">${index + 1}</div>`,
          iconSize: [28, 28],
          iconAnchor: [14, 14],
        });
        boundsLayers.push(
          L.marker(coord, { icon, zIndexOffset: 600 })
            .addTo(layerGroup)
            .bindPopup(`<strong>Chặng ${index + 1}</strong><br/>${leg.origin} → ${leg.destination}`),
        );
      });
      // Terminal stop: mark the final destination so the trip's end is visible.
      const lastLeg = legs[legs.length - 1];
      if (lastLeg?.destinationCoord) {
        boundsLayers.push(
          L.marker(lastLeg.destinationCoord, {
            icon: L.divIcon({ className: 'custom-map-marker', html: '<div style="width:20px;height:20px;background:#EF4444;border:2px solid #fff;border-radius:50%;outline:2px solid rgba(239,68,68,0.28);"></div>', iconSize: [20, 20], iconAnchor: [10, 10] }),
          })
            .addTo(layerGroup)
            .bindPopup(`<strong>Đích đến:</strong> ${lastLeg.destination}`),
        );
      }
    } else if (legs && legs.length > 0) {
      // Route-config mode (no real trail): per-leg colored segments + numbered
      // markers at each leg's polyline start. Legs without a captured route still
      // get a numbered marker at their geocoded origin (no line — no fake route),
      // so the stop sequence (1..N) stays complete. Alternate colors Green/Cyan/Blue/Purple.
      const colors = ['#10B981', '#06B6D4', '#3B82F6', '#8B5CF6'];
      legs.forEach((leg, index) => {
        const color = colors[index % colors.length];
        if (leg.polylinePath) {
          drawRoute(
            leg.polylinePath,
            color,
            `<strong>Chặng ${index + 1} xuất phát:</strong> ${leg.origin}`,
            `<strong>Chặng ${index + 1} đích đến:</strong> ${leg.destination}`,
            { startNumber: index + 1, withEnd: false },
          );
        } else if (leg.originCoord) {
          const icon = L.divIcon({
            className: 'custom-map-marker',
            html: `<div style="width:28px;height:28px;border-radius:50%;background:${color};color:#fff;border:2px solid #fff;outline:1px solid rgba(16,24,20,0.28);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;line-height:1.35;">${index + 1}</div>`,
            iconSize: [28, 28],
            iconAnchor: [14, 14],
          });
          boundsLayers.push(
            L.marker(leg.originCoord, { icon, zIndexOffset: 600 })
              .addTo(layerGroup)
              .bindPopup(`<strong>Chặng ${index + 1}</strong><br/>${leg.origin} → ${leg.destination}`),
          );
        }
      });
      // Terminal stop marker (final destination) when resolvable.
      const lastLeg = legs[legs.length - 1];
      if (lastLeg?.destinationCoord) {
        boundsLayers.push(
          L.marker(lastLeg.destinationCoord, {
            icon: L.divIcon({ className: 'custom-map-marker', html: '<div style="width:20px;height:20px;background:#EF4444;border:2px solid #fff;border-radius:50%;outline:2px solid rgba(239,68,68,0.28);"></div>', iconSize: [20, 20], iconAnchor: [10, 10] }),
          })
            .addTo(layerGroup)
            .bindPopup(`<strong>Đích đến:</strong> ${lastLeg.destination}`),
        );
      }
    } else if (polylinePath) {
      drawRoute(polylinePath, '#10B981', `<strong>Từ:</strong> ${originName}`, `<strong>Đến:</strong> ${destinationName}`);
    }

    // Overlay the truck's live position on top of the route
    if (livePosition) {
      const marker = L.marker([livePosition.lat, livePosition.lng], {
        icon: liveMarkerIcon(livePosition.status, livePosition.angle ?? 0),
        zIndexOffset: 1000,
      })
        .addTo(layerGroup)
        .bindPopup(
          `<strong>Vị trí hiện tại</strong><br/>${LIVE_STATUS_LABEL[livePosition.status]} · ${Math.round(livePosition.speed)} km/h`,
        );
      boundsLayers.push(marker);
    }

    if (boundsLayers.length > 0) {
      map.fitBounds(L.featureGroup(boundsLayers).getBounds(), {
        padding: [50, 50],
        maxZoom: 13,
      });
    }

    // Recalculate container dimensions on load/tab switch
    const timer = setTimeout(() => {
      map.invalidateSize();
    }, 100);

    return () => clearTimeout(timer);
    // Depend on livePosition's primitive fields, not the object: the caller
    // rebuilds it as a fresh object literal each render, which would otherwise
    // trigger clearLayers + redraw + fitBounds on every unrelated re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    polylinePath, legs, originName, destinationName, gpsTrail?.encodedPolyline,
    livePosition?.lat, livePosition?.lng, livePosition?.angle,
    livePosition?.status, livePosition?.speed,
  ]);

  // Clean up Leaflet on unmount
  useEffect(() => {
    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        layerGroupRef.current = null;
      }
    };
  }, []);

  return (
    <div
      className={className}
      style={{
        position: 'relative',
        zIndex: 1,
        width: '100%',
        height,
        borderRadius: 'var(--app-radius-lg, 12px)',
        overflow: 'hidden',
        border: '1px solid var(--border-2, #E5E7EB)',
        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)',
      }}
    >
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
    </div>
  );
}
