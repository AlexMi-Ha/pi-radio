import { AudioAdapter } from '../../../src/adapters/audio/AudioAdapter';
import { AudioProvider } from '../../../src/adapters/audio/AudioProvider';
import { Mode } from '../../../src/core/models/State';
import { exec } from 'child_process';

jest.mock('child_process', () => ({
    exec: jest.fn()
}));

describe('AudioAdapter', () => {

    let providerA: any;
    let providerB: any;
    let adapter: AudioAdapter;

    beforeEach(() => {
        providerA = {
            mode: 'fm' as Mode,
            start: jest.fn().mockResolvedValue(undefined),
            stop: jest.fn().mockResolvedValue(undefined)
        };
        providerB = {
            mode: 'internet_radio' as Mode,
            start: jest.fn().mockResolvedValue(undefined),
            stop: jest.fn().mockResolvedValue(undefined)
        };

        (exec as jest.Mock).mockReset();

        adapter = new AudioAdapter([providerA, providerB]);
    });

    // ------------------------
    // playMode
    // ------------------------

    test('plays a mode with correct provider', async () => {
        await adapter.playMode('fm', 3);

        expect(providerA.start).toHaveBeenCalledWith(3);
        expect(providerB.start).not.toHaveBeenCalled();
    });

    test('throws if no provider for mode', async () => {
        await expect(adapter.playMode('bluetooth' as Mode, 0))
            .rejects.toThrow('No audio provider found for bluetooth');
    });

    test('stops previous provider before starting new', async () => {
        await adapter.playMode('fm', 1);
        await adapter.playMode('internet_radio', 2);

        expect(providerA.stop).toHaveBeenCalled();
        expect(providerB.start).toHaveBeenCalledWith(2);
        expect(providerB.stop).not.toHaveBeenCalled();
    });

    test('does stop provider if same mode played again', async () => {
        await adapter.playMode('fm', 1);
        await adapter.playMode('fm', 2);

        expect(providerA.stop).toHaveBeenCalledTimes(1);
        expect(providerA.start).toHaveBeenCalledWith(2);
    });

    // ------------------------
    // stop
    // ------------------------

    test('stop calls current provider stop', async () => {
        await adapter.playMode('fm', 1);
        await adapter.stop();

        expect(providerA.stop).toHaveBeenCalledTimes(1);
    });

    test('stop does nothing if no current provider', async () => {
        await adapter.stop();
        
        expect(providerA.stop).not.toHaveBeenCalled();
        expect(providerB.stop).not.toHaveBeenCalled();
    });

    // ------------------------
    // setVolume
    // ------------------------

    test('setVolume clamps values between 0 and 100', async () => {
        ((exec as unknown) as jest.Mock).mockImplementation((_cmd: string, cb: any) => cb(null));

        await adapter.setVolume(150);
        expect(exec).toHaveBeenCalledWith('amixer set Master 100%', expect.any(Function));

        await adapter.setVolume(-50);
        expect(exec).toHaveBeenCalledWith('amixer set Master 0%', expect.any(Function));

        await adapter.setVolume(42);
        expect(exec).toHaveBeenCalledWith('amixer set Master 42%', expect.any(Function));
    });

    test('setVolume rejects if exec fails', async () => {
        ((exec as unknown) as jest.Mock).mockImplementation((_cmd: string, cb: any) => cb(new Error('fail')));

        await expect(adapter.setVolume(50)).rejects.toThrow('fail');
    });
});