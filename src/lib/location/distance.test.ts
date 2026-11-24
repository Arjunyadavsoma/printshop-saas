import { describe, it, expect } from 'vitest';
import {
  haversineKm,
  formatDistance,
  isValidCoordinate,
  boundingBox,
  isInsideBoundingBox,
  sortByDistance,
} from './distance';

const HYD = { latitude: 17.385, longitude: 78.4867 }; // Hyderabad
const BLR = { latitude: 12.9716, longitude: 77.5946 }; // Bengaluru
const SECUNDERABAD = { latitude: 17.4399, longitude: 78.4983 };

describe('haversineKm', () => {
  it('same coordinates = 0', () => {
    expect(haversineKm(HYD, HYD)).toBe(0);
  });

  it('nearby points are a few km apart', () => {
    const d = haversineKm(HYD, SECUNDERABAD);
    expect(d).toBeGreaterThan(5);
    expect(d).toBeLessThan(8);
  });

  it('Hyderabad–Bengaluru is ~500 km', () => {
    const d = haversineKm(HYD, BLR);
    expect(d).toBeGreaterThan(480);
    expect(d).toBeLessThan(520);
  });

  it('is symmetric', () => {
    expect(haversineKm(HYD, BLR)).toBeCloseTo(haversineKm(BLR, HYD), 9);
  });
});

describe('formatDistance', () => {
  it('formats sub-km as metres', () => {
    expect(formatDistance(0.85)).toBe('850 m');
    expect(formatDistance(0)).toBe('0 m');
  });

  it('formats >= 1 km with one decimal', () => {
    expect(formatDistance(1.24)).toBe('1.2 km');
    expect(formatDistance(12)).toBe('12.0 km');
  });

  it('boundary: just under / at 1 km', () => {
    expect(formatDistance(0.999)).toBe('1000 m');
    expect(formatDistance(1)).toBe('1.0 km');
  });

  it('rejects non-finite / negative input', () => {
    expect(formatDistance(NaN)).toBe('—');
    expect(formatDistance(-1)).toBe('—');
  });
});

describe('isValidCoordinate', () => {
  it('accepts valid coords incl. boundary values', () => {
    expect(isValidCoordinate(17.38, 78.48)).toBe(true);
    expect(isValidCoordinate(-90, -180)).toBe(true);
    expect(isValidCoordinate(90, 180)).toBe(true);
  });

  it('rejects invalid / missing coords', () => {
    expect(isValidCoordinate(91, 78)).toBe(false);
    expect(isValidCoordinate(17, 181)).toBe(false);
    expect(isValidCoordinate(NaN, 78)).toBe(false);
    expect(isValidCoordinate(undefined, 78)).toBe(false);
    expect(isValidCoordinate('17.38', 78)).toBe(false);
    expect(isValidCoordinate(null, null)).toBe(false);
  });
});

describe('boundingBox', () => {
  it('contains the centre and excludes far points', () => {
    const box = boundingBox(HYD.latitude, HYD.longitude, 5);
    expect(isInsideBoundingBox(HYD, box)).toBe(true);
    expect(isInsideBoundingBox(BLR, box)).toBe(false);
    expect(isInsideBoundingBox(SECUNDERABAD, box)).toBe(false); // ~6.2 km away
  });

  it('boundary radius: a point just inside the box edge stays in', () => {
    const box = boundingBox(HYD.latitude, HYD.longitude, 10);
    // 9.9 km due north of Hyderabad.
    const nearEdge = {
      latitude: HYD.latitude + (9.9 / 111.32),
      longitude: HYD.longitude,
    };
    expect(isInsideBoundingBox(nearEdge, box)).toBe(true);
    expect(haversineKm(HYD, nearEdge)).toBeLessThan(10);
  });
});

describe('sortByDistance', () => {
  it('sorts nearest-first and does not mutate the input', () => {
    const shops = [
      { id: 'blr', ...BLR },
      { id: 'sec', ...SECUNDERABAD },
      { id: 'hyd', ...HYD },
    ];
    const sorted = sortByDistance(shops, HYD);
    expect(sorted.map((s) => s.id)).toEqual(['hyd', 'sec', 'blr']);
    expect(shops[0]!.id).toBe('blr');
  });
});
