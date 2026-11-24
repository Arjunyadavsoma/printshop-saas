import { describe, it, expect } from 'vitest';
import {
  isShopOpenNow,
  openStatusLabel,
  shopOpenStatus,
  parseOpeningHours,
  type WeeklyOpeningHours,
} from './opening-hours';

// 2026-11-24 is a Tuesday. All `now` values are built as UTC instants and
// interpreted in Asia/Kolkata (UTC+5:30), so 04:30Z == 10:00 IST Tuesday.
const tue10am = new Date('2026-11-24T04:30:00Z'); // Tue 10:00 IST
const tue8pm = new Date('2026-11-24T14:30:00Z'); // Tue 20:00 IST
const tue11pm = new Date('2026-11-24T17:30:00Z'); // Tue 23:00 IST
const wed1am = new Date('2026-11-24T19:30:00Z'); // Wed 01:00 IST
const wed8am = new Date('2026-11-25T02:30:00Z'); // Wed 08:00 IST

const NINE_TO_NINE: WeeklyOpeningHours = {
  mon: [{ open: '09:00', close: '21:00' }],
  tue: [{ open: '09:00', close: '21:00' }],
  wed: [{ open: '09:00', close: '21:00' }],
  thu: [{ open: '09:00', close: '21:00' }],
  fri: [{ open: '09:00', close: '21:00' }],
  sat: [{ open: '09:00', close: '21:00' }],
};

const OVERNIGHT: WeeklyOpeningHours = {
  tue: [{ open: '20:00', close: '02:00' }],
  wed: [{ open: '20:00', close: '02:00' }],
};

describe('isShopOpenNow', () => {
  it('open inside hours, closed outside', () => {
    expect(isShopOpenNow(NINE_TO_NINE, 'Asia/Kolkata', tue10am)).toBe(true);
    expect(isShopOpenNow(NINE_TO_NINE, 'Asia/Kolkata', tue11pm)).toBe(false);
  });

  it('closed on a day with no hours (Sunday)', () => {
    const sun10am = new Date('2026-11-29T04:30:00Z'); // Sun 10:00 IST
    expect(isShopOpenNow(NINE_TO_NINE, 'Asia/Kolkata', sun10am)).toBe(false);
  });

  it('no hours at all means no schedule restriction', () => {
    expect(isShopOpenNow(null, 'Asia/Kolkata', tue11pm)).toBe(true);
    expect(isShopOpenNow({}, 'Asia/Kolkata', tue11pm)).toBe(true);
    expect(isShopOpenNow(undefined, 'Asia/Kolkata', tue11pm)).toBe(true);
  });

  it('overnight session: open late evening and after midnight', () => {
    expect(isShopOpenNow(OVERNIGHT, 'Asia/Kolkata', tue8pm)).toBe(true);
    expect(isShopOpenNow(OVERNIGHT, 'Asia/Kolkata', wed1am)).toBe(true);
  });

  it('overnight session: closed before it starts and after it ends', () => {
    expect(isShopOpenNow(OVERNIGHT, 'Asia/Kolkata', tue10am)).toBe(false);
    expect(isShopOpenNow(OVERNIGHT, 'Asia/Kolkata', wed8am)).toBe(false);
  });

  it('split sessions: open in each session, closed in the gap', () => {
    const split: WeeklyOpeningHours = {
      tue: [
        { open: '09:00', close: '13:00' },
        { open: '16:00', close: '21:00' },
      ],
    };
    const tueNoon = new Date('2026-11-24T06:30:00Z'); // 12:00 IST
    const tue3pm = new Date('2026-11-24T09:30:00Z'); // 15:00 IST
    const tue5pm = new Date('2026-11-24T11:30:00Z'); // 17:00 IST
    expect(isShopOpenNow(split, 'Asia/Kolkata', tueNoon)).toBe(true);
    expect(isShopOpenNow(split, 'Asia/Kolkata', tue3pm)).toBe(false);
    expect(isShopOpenNow(split, 'Asia/Kolkata', tue5pm)).toBe(true);
  });

  it('ignores malformed sessions instead of crashing', () => {
    const bad = { tue: [{ open: '25:00', close: '21:00' }] };
    expect(parseOpeningHours(bad)).toEqual({});
    // All sessions dropped → no usable hours → no schedule restriction,
    // same as a shop that never set hours.
    expect(isShopOpenNow(bad, 'Asia/Kolkata', tue10am)).toBe(true);
  });
});

describe('openStatusLabel', () => {
  it('"Open now" inside hours', () => {
    expect(openStatusLabel(NINE_TO_NINE, 'Asia/Kolkata', tue10am)).toBe(
      'Open now',
    );
  });

  it('"Closes at 9:00 PM" within 60 minutes of closing', () => {
    const tue820pm = new Date('2026-11-24T14:50:00Z'); // 20:20 IST
    expect(openStatusLabel(NINE_TO_NINE, 'Asia/Kolkata', tue820pm)).toBe(
      'Closes at 9:00 PM',
    );
  });

  it('"Closed" + opens tomorrow when the next session is tomorrow', () => {
    // Shop open Mon–Fri only; Friday 23:00 → next opening Monday.
    const weekdays: WeeklyOpeningHours = {
      mon: [{ open: '09:00', close: '18:00' }],
      tue: [{ open: '09:00', close: '18:00' }],
      wed: [{ open: '09:00', close: '18:00' }],
      thu: [{ open: '09:00', close: '18:00' }],
      fri: [{ open: '09:00', close: '18:00' }],
    };
    const fri11pm = new Date('2026-11-27T17:30:00Z'); // Fri 23:00 IST
    expect(openStatusLabel(weekdays, 'Asia/Kolkata', fri11pm)).toBe(
      'Opens Monday at 9:00 AM',
    );
    // Tuesday 23:00 → opens tomorrow (Wednesday) at 9:00 AM.
    expect(openStatusLabel(weekdays, 'Asia/Kolkata', tue11pm)).toBe(
      'Opens tomorrow at 9:00 AM',
    );
  });

  it('"Opens today at 9:00 AM" before opening', () => {
    const tue8am = new Date('2026-11-24T02:30:00Z'); // 08:00 IST
    expect(openStatusLabel(NINE_TO_NINE, 'Asia/Kolkata', tue8am)).toBe(
      'Opens today at 9:00 AM',
    );
  });

  it('"Temporarily unavailable" when not accepting orders, even in hours', () => {
    expect(
      openStatusLabel(NINE_TO_NINE, 'Asia/Kolkata', tue10am, {
        acceptingOrders: false,
      }),
    ).toBe('Temporarily unavailable');
    expect(
      openStatusLabel(NINE_TO_NINE, 'Asia/Kolkata', tue10am, {
        isOpen: false,
      }),
    ).toBe('Temporarily unavailable');
  });

  it('no hours: label follows the manual flags only', () => {
    expect(openStatusLabel(null, 'Asia/Kolkata', tue10am)).toBe('Open now');
    expect(
      openStatusLabel(null, 'Asia/Kolkata', tue10am, { isOpen: false }),
    ).toBe('Temporarily unavailable');
  });
});

describe('shopOpenStatus', () => {
  it('combines schedule + manual flags', () => {
    const shop = {
      openingHours: NINE_TO_NINE,
      timezone: 'Asia/Kolkata',
      isOpen: true,
      acceptingOrders: true,
    };
    expect(shopOpenStatus(shop, tue10am)).toEqual({
      open: true,
      label: 'Open now',
    });
    expect(shopOpenStatus(shop, tue11pm)).toEqual({
      open: false,
      label: 'Opens tomorrow at 9:00 AM',
    });
    expect(
      shopOpenStatus({ ...shop, acceptingOrders: false }, tue10am),
    ).toEqual({ open: false, label: 'Temporarily unavailable' });
  });
});
