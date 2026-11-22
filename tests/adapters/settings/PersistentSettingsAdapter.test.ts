import fs from 'fs';
import os from 'os';
import path from 'path';
import { PersistentSettingsAdapter } from '../../../src/adapters/settings/PersistentSettingsAdapter';

describe('PersistentSettingsAdapter', () => {
    let filePath: string;

    beforeEach(() => {
        filePath = path.join(os.tmpdir(), `settings-test-${Date.now()}-${Math.random()}.json`);
    });

    afterEach(() => {
        if(fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
    });

    test('returns undefined when no file exists yet', () => {
        const adapter = new PersistentSettingsAdapter(filePath);

        expect(adapter.load()).toBeUndefined();
    });

    test('round-trips mode/volume/preset through save/load', () => {
        const adapter = new PersistentSettingsAdapter(filePath);
        adapter.save({ mode: 'bluetooth', volume: 73, preset: 2 });

        const reloaded = new PersistentSettingsAdapter(filePath);

        expect(reloaded.load()).toEqual({ mode: 'bluetooth', volume: 73, preset: 2 });
    });

    test('returns undefined if the file is corrupt', () => {
        fs.writeFileSync(filePath, 'not json', 'utf-8');

        const adapter = new PersistentSettingsAdapter(filePath);

        expect(adapter.load()).toBeUndefined();
    });
});
