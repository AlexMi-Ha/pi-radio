import { clamp, wrap } from "../../../src/core/util/util"

describe('clamp()', () => {

    test('clamp returns value between minmax', () => {
        const res = clamp(0, 100, 50);
        expect(res).toEqual(50);
    });

    test('clamp returns value clamped to min', () => {
        const res = clamp(0, 100, -50);
        expect(res).toEqual(0);
    });

    test('clamp returns value clamped to max', () => {
        const res = clamp(0, 100, 150);
        expect(res).toEqual(100);
    });
});


describe('wrap()', () => {
    const min = 0;
    const max = 10;
    test('increments within range without wrapping', () => {
        expect(wrap(min, max, 5, 2)).toBe(7);
    });

    test('wraps around when exceeding max', () => {
        expect(wrap(min, max, 9, 3)).toBe(1); // 12 → wraps to 1
    });

    test('wraps around when going below min', () => {
        expect(wrap(min, max, 1, -3)).toBe(9); // -2 → wraps to 9
    });

    test('stays the same when delta is 0', () => {
        expect(wrap(min, max, 4, 0)).toBe(4);
    });

    test('wraps exactly to min when crossing max boundary', () => {
        expect(wrap(min, max, 10, 1)).toBe(0);
    });

    test('wraps exactly to max when crossing min boundary', () => {
        expect(wrap(min, max, 0, -1)).toBe(10);
    });

    test('handles large positive delta', () => {
        expect(wrap(min, max, 3, 25)).toBe(6);
    });

    test('handles large negative delta', () => {
        expect(wrap(min, max, 3, -25)).toBe(0);
    });

    test('works when current equals min', () => {
        expect(wrap(min, max, 0, 5)).toBe(5);
    });

    test('works when current equals max', () => {
        expect(wrap(min, max, 10, -2)).toBe(8);
    });

    test('works with non-zero min range', () => {
        expect(wrap(5, 15, 10, 10)).toBe(9);
    });

    test('single-value range always returns min/max', () => {
        expect(wrap(3, 3, 3, 100)).toBe(3);
        expect(wrap(3, 3, 3, -100)).toBe(3);
    });
})