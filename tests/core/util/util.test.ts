import { clamp } from "../../../src/core/util/util"

describe('util', () => {

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