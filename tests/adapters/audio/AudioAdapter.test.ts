import { AudioAdapter } from '../../../src/adapters/audio/AudioAdapter';
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
            mode: 'internet_radio' as Mode,
            start: jest.fn().mockResolvedValue(undefined),
            stop: jest.fn().mockResolvedValue(undefined),
            onNowPlayingChanged: jest.fn()
        };
        providerB = {
            mode: 'bluetooth' as Mode,
            start: jest.fn().mockResolvedValue(undefined),
            stop: jest.fn().mockResolvedValue(undefined),
            enablePairing: jest.fn().mockResolvedValue(undefined)
        };

        (exec as jest.Mock).mockReset();

        adapter = new AudioAdapter([providerA, providerB]);
    });

    // ------------------------
    // playMode
    // ------------------------

    test('plays a mode with correct provider', async () => {
        await adapter.playMode('internet_radio', 3);

        expect(providerA.start).toHaveBeenCalledWith(3);
        expect(providerB.start).not.toHaveBeenCalled();
    });

    test('throws if no provider for mode', async () => {
        await expect(adapter.playMode('unknown' as Mode, 0))
            .rejects.toThrow('No audio provider found for unknown');
    });

    test('stops previous provider before starting new', async () => {
        await adapter.playMode('internet_radio', 1);
        await adapter.playMode('bluetooth', 2);

        expect(providerA.stop).toHaveBeenCalled();
        expect(providerB.start).toHaveBeenCalledWith(2);
        expect(providerB.stop).not.toHaveBeenCalled();
    });

    test('does stop provider if same mode played again', async () => {
        await adapter.playMode('internet_radio', 1);
        await adapter.playMode('internet_radio', 2);

        expect(providerA.stop).toHaveBeenCalledTimes(1);
        expect(providerA.start).toHaveBeenCalledWith(2);
    });

    test('still starts the new provider if stopping the previous one fails', async () => {
        providerB.stop.mockRejectedValue(new Error('bluetoothctl timed out'));
        jest.spyOn(console, 'error').mockImplementation(() => {});

        await adapter.playMode('bluetooth', 0);
        await adapter.playMode('internet_radio', 1);

        expect(providerB.stop).toHaveBeenCalled();
        expect(providerA.start).toHaveBeenCalledWith(1);

        (console.error as jest.Mock).mockRestore();
    });

    // ------------------------
    // stop
    // ------------------------

    test('stop calls current provider stop', async () => {
        await adapter.playMode('internet_radio', 1);
        await adapter.stop();

        expect(providerA.stop).toHaveBeenCalledTimes(1);
    });

    test('stop does nothing if no current provider', async () => {
        await adapter.stop();

        expect(providerA.stop).not.toHaveBeenCalled();
        expect(providerB.stop).not.toHaveBeenCalled();
    });

    // ------------------------
    // enablePairing
    // ------------------------

    test('enablePairing delegates to current provider', async () => {
        await adapter.playMode('bluetooth', 0);
        await adapter.enablePairing();

        expect(providerB.enablePairing).toHaveBeenCalled();
    });

    test('enablePairing throws if current provider does not support it', async () => {
        await adapter.playMode('internet_radio', 0);

        await expect(adapter.enablePairing()).rejects.toThrow('does not support pairing');
    });

    // ------------------------
    // now playing
    // ------------------------

    test('forwards now-playing updates from the current provider', async () => {
        const callback = jest.fn();
        adapter.onNowPlayingChanged(callback);

        await adapter.playMode('internet_radio', 0);

        const forward = providerA.onNowPlayingChanged.mock.calls[0][0];
        forward({ title: 'Track' });

        expect(callback).toHaveBeenCalledWith({ title: 'Track' });
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
