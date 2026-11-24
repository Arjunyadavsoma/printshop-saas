import { describe, expect, it } from 'vitest';
import {
  isValidIndianPincode,
  isValidLatitude,
  isValidLongitude,
  parseLatitude,
  parseLongitude,
  validateShopLocation,
  openStreetMapUrl,
  openStreetMapEmbedUrl,
} from './validation';

describe('isValidIndianPincode', () => {
  it('accepts a normal 6-digit PIN', () => {
    expect(isValidIndianPincode('500075')).toBe(true);
    expect(isValidIndianPincode('110001')).toBe(true);
  });

  it('trims surrounding whitespace', () => {
    expect(isValidIndianPincode(' 500075 ')).toBe(true);
  });

  it('rejects a leading zero', () => {
    expect(isValidIndianPincode('012345')).toBe(false);
  });

  it('rejects 5- and 7-digit values', () => {
    expect(isValidIndianPincode('50007')).toBe(false);
    expect(isValidIndianPincode('5000755')).toBe(false);
  });

  it('rejects letters, blanks and non-strings', () => {
    expect(isValidIndianPincode('50007A')).toBe(false);
    expect(isValidIndianPincode('')).toBe(false);
    expect(isValidIndianPincode('   ')).toBe(false);
    expect(isValidIndianPincode(500075)).toBe(false);
    expect(isValidIndianPincode(null)).toBe(false);
    expect(isValidIndianPincode(undefined)).toBe(false);
  });
});

describe('parseLatitude / parseLongitude', () => {
  it('accepts the inclusive boundaries', () => {
    expect(parseLatitude(-90)).toBe(-90);
    expect(parseLatitude(90)).toBe(90);
    expect(parseLongitude(-180)).toBe(-180);
    expect(parseLongitude(180)).toBe(180);
  });

  it('accepts numeric strings', () => {
    expect(parseLatitude('17.3850')).toBeCloseTo(17.385);
    expect(parseLongitude(' 78.4867 ')).toBeCloseTo(78.4867);
  });

  it('rejects out-of-range values instead of clamping them', () => {
    // A clamping implementation would return 90 / 180 here.
    expect(parseLatitude(91)).toBeNull();
    expect(parseLatitude(-90.0001)).toBeNull();
    expect(parseLongitude(181)).toBeNull();
    expect(parseLongitude(-180.5)).toBeNull();
    expect(parseLatitude('91')).toBeNull();
  });

  it('rejects empty, non-numeric and non-finite input', () => {
    expect(parseLatitude('')).toBeNull();
    expect(parseLatitude('   ')).toBeNull();
    expect(parseLatitude('abc')).toBeNull();
    expect(parseLatitude('17,38')).toBeNull();
    expect(parseLatitude(Number.NaN)).toBeNull();
    expect(parseLatitude(Number.POSITIVE_INFINITY)).toBeNull();
    expect(parseLongitude(null)).toBeNull();
    expect(parseLongitude(undefined)).toBeNull();
    expect(parseLongitude({})).toBeNull();
  });
});

describe('isValidLatitude / isValidLongitude', () => {
  it('agrees with the parsers', () => {
    expect(isValidLatitude(17.38)).toBe(true);
    expect(isValidLatitude(91)).toBe(false);
    expect(isValidLatitude('')).toBe(false);
    expect(isValidLongitude(78.48)).toBe(true);
    expect(isValidLongitude(200)).toBe(false);
  });
});

describe('validateShopLocation', () => {
  it('returns no errors when everything is empty (location is optional)', () => {
    expect(validateShopLocation({})).toEqual({});
    expect(validateShopLocation({ pincode: '', latitude: '', longitude: '' })).toEqual({});
    expect(validateShopLocation({ pincode: null, latitude: null, longitude: null })).toEqual({});
  });

  it('returns no errors for a fully valid location', () => {
    expect(
      validateShopLocation({ pincode: '500075', latitude: '17.385', longitude: '78.4867' }),
    ).toEqual({});
  });

  it('flags a bad PIN but leaves coordinates alone', () => {
    const errors = validateShopLocation({ pincode: '01234', latitude: 17.38, longitude: 78.48 });
    expect(errors.pincode).toMatch(/6-digit/);
    expect(errors.latitude).toBeUndefined();
    expect(errors.longitude).toBeUndefined();
  });

  it('flags out-of-range coordinates', () => {
    const errors = validateShopLocation({ latitude: 91, longitude: 200 });
    expect(errors.latitude).toMatch(/-90 and 90/);
    expect(errors.longitude).toMatch(/-180 and 180/);
  });

  it('flags a half-filled coordinate pair', () => {
    expect(validateShopLocation({ latitude: 17.38 }).longitude).toMatch(/longitude/);
    expect(validateShopLocation({ longitude: 78.48 }).latitude).toMatch(/latitude/);
  });

  it('does not add a pair error when the present half is itself invalid', () => {
    const errors = validateShopLocation({ latitude: 91 });
    expect(errors.latitude).toMatch(/-90 and 90/);
    expect(errors.longitude).toBeUndefined();
  });
});

describe('OpenStreetMap links', () => {
  it('builds a marker link with the coordinates', () => {
    const url = openStreetMapUrl(17.385, 78.4867);
    expect(url).toContain('mlat=17.385');
    expect(url).toContain('mlon=78.4867');
    expect(url.startsWith('https://www.openstreetmap.org/')).toBe(true);
  });

  it('builds an embed URL with a bbox around the marker', () => {
    const url = openStreetMapEmbedUrl(17.385, 78.4867);
    expect(url).toContain('export/embed.html');
    expect(url).toContain('marker=17.385,78.4867');
  });
});
