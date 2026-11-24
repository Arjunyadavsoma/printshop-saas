import { describe, expect, it } from 'vitest';
import {
  filterShops,
  parseOpenStatus,
  type NearbyShop,
} from './shop-filters';

const shops: NearbyShop[] = [
  {
    id: '1',
    name: 'Alpha Prints',
    slug: 'alpha-prints',
    address: '12 MG Road, Hyderabad 500001',
    latitude: 17.38,
    longitude: 78.48,
    distanceKm: 0.8,
    openStatus: 'open',
    pricingSummary: { bwA4PerPage: 200, colorA4PerPage: 500 },
    availableServices: ['bw', 'colour'],
  },
  {
    id: '2',
    name: 'Beta Xerox',
    slug: 'beta-xerox',
    address: '45 Jubilee Hills, Hyderabad 500033',
    latitude: 17.43,
    longitude: 78.4,
    distanceKm: 4.2,
    openStatus: 'closed',
    pricingSummary: { bwA4PerPage: 150, colorA4PerPage: null },
    availableServices: ['bw'],
  },
  {
    id: '3',
    name: 'Gamma Colour Hub',
    slug: 'gamma-colour-hub',
    address: '8 Banjara Hills, Hyderabad 500034',
    // No coordinates yet — distance must stay unknown, never invented.
    latitude: null,
    longitude: null,
    distanceKm: null,
    openStatus: true,
    pricingSummary: { bwA4PerPage: null, colorA4PerPage: 800 },
    availableServices: ['colour'],
  },
  {
    id: '4',
    name: 'Delta Prints',
    slug: 'delta-prints',
    address: '3 Secunderabad 500003',
    latitude: 17.44,
    longitude: 78.5,
    distanceKm: 12.0,
    // No openStatus at all — unknown, not closed.
    openStatus: null,
    pricingSummary: { bwA4PerPage: 200, colorA4PerPage: 500 },
    availableServices: ['bw', 'colour'],
  },
];

describe('parseOpenStatus', () => {
  it('accepts boolean, string and object shapes', () => {
    expect(parseOpenStatus(true).isOpen).toBe(true);
    expect(parseOpenStatus('closed').isOpen).toBe(false);
    expect(parseOpenStatus({ isOpen: true, closesAt: '21:00' })).toEqual({
      isOpen: true,
      closesAt: '21:00',
    });
    expect(parseOpenStatus({ status: 'closed' }).isOpen).toBe(false);
  });

  it('returns unknown (null) when the API says nothing', () => {
    expect(parseOpenStatus(null)).toEqual({ isOpen: null, closesAt: null });
    expect(parseOpenStatus(undefined)).toEqual({ isOpen: null, closesAt: null });
  });
});

describe('filterShops', () => {
  it('matches search against name, address and PIN digits', () => {
    expect(filterShops(shops, { search: 'beta' }).map((s) => s.id)).toEqual(['2']);
    expect(filterShops(shops, { search: '500034' }).map((s) => s.id)).toEqual(['3']);
    expect(filterShops(shops, { search: 'hyderabad' })).toHaveLength(3);
  });

  it('matches a manual place query (area / city / PIN) against the address only', () => {
    expect(filterShops(shops, { placeQuery: 'jubilee' }).map((s) => s.id)).toEqual(['2']);
    // A name-only match must NOT satisfy the place query.
    expect(filterShops(shops, { placeQuery: 'gamma' })).toHaveLength(0);
  });

  it('open-now keeps open and unknown-status shops, drops closed ones', () => {
    expect(filterShops(shops, { openNowOnly: true }).map((s) => s.id)).toEqual(['1', '3', '4']);
  });

  it('service filter uses pricing and available services', () => {
    expect(filterShops(shops, { service: 'colour' }).map((s) => s.id)).toEqual(['1', '3', '4']);
    expect(filterShops(shops, { service: 'bw' }).map((s) => s.id)).toEqual(['1', '2', '4']);
  });

  it('radius filter drops shops proven out of range but keeps unlocated ones', () => {
    const out = filterShops(shops, { hasLocation: true, radiusKm: 5 }).map((s) => s.id);
    expect(out).toEqual(['1', '2', '3']); // 12 km shop dropped; null-distance shop kept
  });

  it('radius is ignored without a location', () => {
    expect(filterShops(shops, { hasLocation: false, radiusKm: 1 })).toHaveLength(4);
  });

  it('sorts by distance with unknown distance last, and never invents one', () => {
    const out = filterShops(shops, { hasLocation: true });
    expect(out.map((s) => s.id)).toEqual(['1', '2', '4', '3']);
    expect(out[3].distanceKm).toBeNull();
  });

  it('combines search + open-now + radius', () => {
    const out = filterShops(shops, {
      search: 'prints',
      openNowOnly: true,
      hasLocation: true,
      radiusKm: 10,
    }).map((s) => s.id);
    expect(out).toEqual(['1']);
  });
});
