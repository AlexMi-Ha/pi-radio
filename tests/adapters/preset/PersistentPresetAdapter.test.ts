import fs from 'fs';
import os from 'os';
import path from 'path';
import { PersistentPresetAdapter } from '../../../src/adapters/preset/PersistentPresetAdapter';

describe('PersistentPresetAdapter', () => {
    let filePath: string;

    beforeEach(() => {
        filePath = path.join(os.tmpdir(), `presets-test-${Date.now()}-${Math.random()}.json`);
    });

    afterEach(() => {
        if(fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
    });

    test('round-trips preset values through save/load as a real Map', () => {
        const adapter = new PersistentPresetAdapter(filePath);
        adapter.setValueForPreset('internet_radio', 0, 'http://example.com/a');
        adapter.setValueForPreset('internet_radio', 1, 'http://example.com/b');

        const reloaded = new PersistentPresetAdapter(filePath);

        expect(reloaded.getValueByPreset('internet_radio', 0)).toBe('http://example.com/a');
        expect(reloaded.getValueByPreset('internet_radio', 1)).toBe('http://example.com/b');
        expect(reloaded.getAllPresets('internet_radio')).toEqual(
            expect.arrayContaining(['http://example.com/a', 'http://example.com/b'])
        );
    });

    test('rejects preset indices outside the fixed 5-slot range', () => {
        const adapter = new PersistentPresetAdapter(filePath);

        adapter.setValueForPreset('internet_radio', 5, 'http://example.com/out-of-range');

        expect(adapter.getValueByPreset('internet_radio', 5)).toBe('');
    });

    test('falls back to 5 empty slots if the file is corrupt', () => {
        fs.writeFileSync(filePath, 'not json', 'utf-8');

        const adapter = new PersistentPresetAdapter(filePath);

        expect(adapter.getAllPresets('internet_radio')).toEqual(["", "", "", "", ""]);
    });
});
