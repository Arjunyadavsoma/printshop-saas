'use client';

import { useEffect, useMemo, useRef } from 'react';
import L from 'leaflet';
import { MapContainer, Marker, TileLayer, useMap, ZoomControl } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import type { CustomerLocation, NearbyShop } from '@/lib/location/shop-filters';

/**
 * ShopMap — OpenStreetMap via Leaflet + react-leaflet (free, no API key).
 *
 * - Dynamically imported with ssr:false by /find-a-shop (Leaflet touches
 *   `window` at import time, so it must never render on the server).
 * - Tiles: © OpenStreetMap contributors, attribution rendered by the
 *   TileLayer (required by the OSM licence).
 * - Markers come ONLY from real shop coordinates. Shops with null
 *   latitude/longitude are never pinned — they appear in the list only.
 * - Marker icons are divIcons (plain styled dots), not Leaflet's default
 *   image markers, whose bundled image URLs break under Next.js bundling.
 * - No Google Maps anywhere in this component.
 */

export interface ShopMapProps {
  /** Shops to pin — only entries with real coordinates are rendered. */
  shops: NearbyShop[];
  /** Customer position when known (blue/green "you" marker). */
  userLocation: CustomerLocation | null;
  /** Slug/id of the selected shop, if any. */
  selectedId: string | null;
  /** Marker click → parent highlights + scrolls to the card. */
  onSelect: (id: string) => void;
  /** Recenter + fit-bounds target when the user taps "Recenter". */
  onRecenter?: () => void;
}

function shopIcon(selected: boolean): L.DivIcon {
  return L.divIcon({
    className: '',
    iconSize: selected ? [28, 28] : [20, 20],
    iconAnchor: selected ? [14, 14] : [10, 10],
    html: `<span style="display:block;width:${selected ? 28 : 20}px;height:${selected ? 28 : 20}px;border-radius:9999px;background:${selected ? '#0A58D6' : '#ffffff'};border:3px solid #0A58D6;box-shadow:0 1px 4px rgba(0,0,0,.35);"></span>`,
  });
}

const customerIcon = L.divIcon({
  className: '',
  iconSize: [20, 20],
  iconAnchor: [10, 10],
  html: '<span style="display:block;width:20px;height:20px;border-radius:9999px;background:#1E8A56;border:3px solid #ffffff;box-shadow:0 1px 4px rgba(0,0,0,.35);"></span>',
});

/** Pans the map when the selection changes; fits all pins on first load. */
function MapController({  shops,
  userLocation,
  selectedId,
}: {
  shops: NearbyShop[];
  userLocation: CustomerLocation | null;
  selectedId: string | null;
}) {
  const map = useMap();
  const fittedRef = useRef(false);

  const points = useMemo(() => {
    const pts: [number, number][] = [];
    if (userLocation) pts.push([userLocation.lat, userLocation.lng]);
    for (const s of shops) {
      if (s.latitude != null && s.longitude != null) pts.push([s.latitude, s.longitude]);
    }
    return pts;
  }, [shops, userLocation]);

  useEffect(() => {
    if (selectedId) {
      const shop = shops.find((s) => s.id === selectedId);
      if (shop?.latitude != null && shop?.longitude != null) {
        map.flyTo([shop.latitude, shop.longitude], Math.max(map.getZoom(), 15), { duration: 0.5 });
      }
      return;
    }
    if (!fittedRef.current && points.length > 1) {
      fittedRef.current = true;
      map.fitBounds(L.latLngBounds(points), { padding: [24, 24] });
    }
  }, [map, points, selectedId, shops]);

  return null;
}

/** Recenter button — returns the map to the customer (or first shop) position. */
function RecenterButton({ center }: { center: [number, number] }) {
  const map = useMap();
  return (
    <button
      type="button"
      onClick={() => map.flyTo(center, 14, { duration: 0.5 })}
      className="absolute bottom-4 right-3 z-[500] min-h-[44px] rounded-full bg-[var(--surface)] px-4 text-sm font-medium text-[var(--label)] shadow"
      aria-label="Recenter map on your location"
    >
      Recenter
    </button>
  );
}

export function ShopMap({ shops, userLocation, selectedId, onSelect }: ShopMapProps) {
  const located = shops.filter((s) => s.latitude != null && s.longitude != null);
  const selected = shops.find((s) => s.id === selectedId) ?? null;

  // No coordinates anywhere: say so plainly instead of rendering fake pins.
  if (located.length === 0 && !userLocation) {
    return (
      <div
        className="flex min-h-[280px] flex-col items-center justify-center gap-1 rounded-[var(--radius-card)] border border-[var(--hairline)] bg-[var(--surface)] px-4 text-center"
        role="status"
      >
        <p className="text-sm font-medium text-[var(--label)]">No located shops yet</p>
        <p className="max-w-[320px] text-[13px] text-[var(--label-2)]">
          None of the shops listed have shared a map location yet. You can still browse the list
          below and open a shop page.
        </p>
      </div>
    );
  }

  const center: [number, number] = userLocation
    ? [userLocation.lat, userLocation.lng]
    : [located[0].latitude as number, located[0].longitude as number];

  return (
    <div className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--hairline)] bg-[var(--surface)]">
      <div className="relative h-[320px] w-full sm:h-[380px]" aria-label="Map of nearby print shops">
        <MapContainer
          center={center}
          zoom={userLocation ? 14 : 13}
          scrollWheelZoom={false}
          zoomControl={false}
          style={{ height: '100%', width: '100%' }}
        >
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          />
          <ZoomControl position="topright" />
          <RecenterButton center={center} />
          <MapController shops={located} userLocation={userLocation} selectedId={selectedId} />
          {userLocation && (
            <Marker position={[userLocation.lat, userLocation.lng]} icon={customerIcon} />
          )}
          {located.map((shop) => (
            <Marker
              key={shop.id}
              position={[shop.latitude as number, shop.longitude as number]}
              icon={shopIcon(shop.id === selectedId)}
              eventHandlers={{ click: () => onSelect(shop.id) }}
            />
          ))}
        </MapContainer>

        {located.length === 0 && (
          <p className="absolute left-3 top-3 z-[500] rounded-full bg-[var(--surface)] px-3 py-1.5 text-[13px] font-medium text-[var(--label)] shadow">
            No located shops yet — showing your location only
          </p>
        )}
      </div>

      {/* Selected-shop preview card */}
      {selected && (
        <div className="border-t border-[var(--hairline)] px-4 py-3">
          <p className="truncate text-sm font-semibold text-[var(--label)]">{selected.name}</p>
          <p className="truncate text-[13px] text-[var(--label-2)]">{selected.address}</p>
          <p className="mt-1 text-[13px] text-[var(--label-2)]">
            {selected.distanceLabel ??
              (selected.distanceKm != null ? `≈ ${selected.distanceKm} km away` : 'Distance not available')}
            {' · '}
            <a href={`/s/${selected.slug}`} className="font-medium text-[var(--accent)] underline">
              View shop
            </a>
          </p>
        </div>
      )}

      <p className="border-t border-[var(--hairline)] px-4 py-2 text-[12px] text-[var(--label-3)]">
        Map data © OpenStreetMap contributors. Distances are approximate straight-line distances.
      </p>
    </div>
  );
}

export default ShopMap;
