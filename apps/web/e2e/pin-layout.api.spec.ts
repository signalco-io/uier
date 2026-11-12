import { expect, test } from '@playwright/test';
import { pinGap, spreadPins, type PinBox } from '../../../packages/toolbar/src/pinLayout';

// Overlapping pins move apart just enough (uier #367): `pinLayout.ts`, used by every pin on the page

const width = 1000;
const height = 800;

/** A 32 px pin (mouse) with its count badge, or a 44 px hit area (touch), kept 4 px inside the window */
function pin(order: number, x: number, y: number, extra: Partial<PinBox> = {}): PinBox {
    const half = extra.half ?? 16;
    const right = extra.right ?? Math.max(half, 21);
    return {
        x, y, left: half, right, half, order, upsideDown: false,
        minX: half + 4, maxX: width - right - 4, minY: half + 4, maxY: height - half - 4,
        ...extra
    };
}

function placed(pins: Map<string, PinBox>) {
    const shifts = spreadPins(pins);
    return new Map([...pins].map(([key, box]) => {
        const shift = shifts.get(key)!;
        return [key, { box, x: box.x + shift.dx, y: box.y + shift.dy, ...shift }];
    }));
}

/** No two pins (with what reaches out of them) closer than the gap */
function expectApart(result: ReturnType<typeof placed>) {
    const all = [...result.values()];
    for (const [index, a] of all.entries()) {
        for (const b of all.slice(index + 1)) {
            const apartX = a.x + a.box.right + pinGap <= b.x - b.box.left + 0.01 || b.x + b.box.right + pinGap <= a.x - a.box.left + 0.01;
            const apartY = Math.abs(a.y - b.y) >= a.box.half + b.box.half + pinGap - 0.01;
            expect(apartX || apartY, `${JSON.stringify(a)} and ${JSON.stringify(b)}`).toBe(true);
        }
    }
}

test('pins with room stay where they are', () => {
    const result = placed(new Map([['a', pin(1, 100, 100)], ['b', pin(2, 300, 100)], ['c', pin(3, 100, 300)]]));
    for (const { dx, dy } of result.values()) expect({ dx, dy }).toEqual({ dx: 0, dy: 0 });
});

test('a pin on the same spot as an older one goes just beside it, the older one stays', () => {
    const result = placed(new Map([['new', pin(7, 200, 200)], ['old', pin(3, 200, 200)]]));
    expect(result.get('old')).toMatchObject({ dx: 0, dy: 0 });
    // Right of it, its badge and the gap between them
    expect(result.get('new')).toMatchObject({ dx: 21 + pinGap + 16, dy: 0 });
    expectApart(result);
});

test('the people beside a pin keep the next pin clear of them', () => {
    const result = placed(new Map([['a', pin(1, 200, 200, { right: 40 })], ['b', pin(2, 210, 205)]]));
    expect(result.get('a')).toMatchObject({ dx: 0, dy: 0 });
    expect(result.get('b')!.x).toBe(200 + 40 + pinGap + 16);
    expect(result.get('b')!.dy).toBe(0);
    expectApart(result);
});

test('a pin close to an older one on its right moves left, the least move', () => {
    const result = placed(new Map([['a', pin(1, 220, 200)], ['b', pin(2, 200, 200)]]));
    expect(result.get('b')!.x).toBe(220 - 16 - pinGap - 21);
    expectApart(result);
});

test('many pins on one spot all show, inside the window, none moving older ones', () => {
    const pins = new Map<string, PinBox>();
    for (let order = 1; order <= 8; order++) pins.set(`p${order}`, pin(order, 300, 300));
    const result = placed(pins);
    expectApart(result);
    for (const { x, y, box } of result.values()) {
        expect(x).toBeGreaterThanOrEqual(box.minX);
        expect(x).toBeLessThanOrEqual(box.maxX);
        expect(y).toBeGreaterThanOrEqual(box.minY);
        expect(y).toBeLessThanOrEqual(box.maxY);
    }
    // Adding one more never moves the pins already placed
    const more = new Map(pins).set('p9', pin(9, 300, 300));
    const shifts = spreadPins(pins);
    const moreShifts = spreadPins(more);
    for (const key of pins.keys()) expect(moreShifts.get(key)).toEqual(shifts.get(key));
    expectApart(placed(more));
});

test('at the right edge the next pin goes left or to the next row, never out of the window', () => {
    const edge = width - 21 - 4;
    const result = placed(new Map([['a', pin(1, edge, 200)], ['b', pin(2, edge, 200)], ['c', pin(3, edge, 200)]]));
    expectApart(result);
    for (const { x, box } of result.values()) expect(x).toBeLessThanOrEqual(box.maxX);
});

test('upside-down pins at the bottom take the row above, not below the window', () => {
    const bottom = height - 16 - 4;
    const pins = new Map<string, PinBox>();
    for (let order = 1; order <= 6; order++) pins.set(`p${order}`, pin(order, width - 21 - 4, bottom, { upsideDown: true }));
    const result = placed(pins);
    expectApart(result);
    for (const { y, box } of result.values()) expect(y).toBeLessThanOrEqual(box.maxY);
    expect([...result.values()].some(({ dy }) => dy < 0)).toBe(true);
});

test('touch hit areas are kept apart too', () => {
    const touch = { half: 22, right: 22 };
    const result = placed(new Map([['a', pin(1, 200, 200, touch)], ['b', pin(2, 205, 210, touch)]]));
    expectApart(result);
    expect(result.get('b')!.x - result.get('a')!.x).toBeGreaterThanOrEqual(44 + pinGap);
});

test('pins scrolled out of the window are spread without being pulled into it', () => {
    const below = height + 200;
    const result = placed(new Map([['a', pin(1, 200, below)], ['b', pin(2, 200, below)]]));
    expectApart(result);
    expect(result.get('b')!.y).toBe(below);
});
