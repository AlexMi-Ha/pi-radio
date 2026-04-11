import { isPresetMode } from "../../../src/core/models/State";

describe('State', () => {
    test('isPresetMode returns true for preset state', () => {
        expect(isPresetMode("internet_radio")).toBe(true);
        expect(isPresetMode("fm")).toBe(true);
    });

    test('isPresetMode returns false for non preset state', () => {
        expect(isPresetMode("bluetooth")).toBe(false);
        expect(isPresetMode("asd")).toBe(false);
    });
});