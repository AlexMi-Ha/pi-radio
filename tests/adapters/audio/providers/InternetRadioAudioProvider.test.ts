import { InternetRadioAudioProvider } from '../../../../src/adapters/audio/providers/InternetRadioAudioProvider';
import { spawn } from 'child_process';
import net from 'net';

jest.mock('child_process', () => ({
    spawn: jest.fn()
}));

jest.mock('net', () => ({
    createConnection: jest.fn()
}));

describe('InternetRadioAudioProvider', () => {
    let presetPort: any;
    let provider: InternetRadioAudioProvider;
    let mockProcess: any;
    let mockSocket: any;

    beforeEach(() => {
        jest.clearAllMocks();

        mockProcess = {
            stdout: { on: jest.fn() },
            stderr: { on: jest.fn() },
            on: jest.fn(),
            kill: jest.fn()
        };

        (spawn as jest.Mock).mockReturnValue(mockProcess);

        mockSocket = {
            write: jest.fn(),
            on: jest.fn(),
            destroy: jest.fn()
        };
        (net.createConnection as jest.Mock).mockReturnValue(mockSocket);

        presetPort = {
            getNumPresets: jest.fn().mockReturnValue(5),
            getValueByPreset: jest.fn()
        };

        provider = new InternetRadioAudioProvider(presetPort);
        jest.spyOn(console, 'log').mockImplementation(() => {});
        jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    // ------------------------
    // START
    // ------------------------

    test('start does nothing if presetIndex < 0', async () => {
        await provider.start(-1);
        expect(console.error).toHaveBeenCalledWith(
            '[Internet Radio] Error playing station -1. PresetIndex out of bounds!'
        );
        expect(spawn).not.toHaveBeenCalled();
    });

    test('start does nothing if presetIndex > max', async () => {
        await provider.start(10);
        expect(console.error).toHaveBeenCalledWith(
            '[Internet Radio] Error playing station 10. PresetIndex out of bounds!'
        );
        expect(spawn).not.toHaveBeenCalled();
    });

    test('start does nothing if no URL returned', async () => {
        presetPort.getValueByPreset.mockReturnValue(undefined);

        await provider.start(2);

        expect(console.error).toHaveBeenCalledWith(
            '[Internet Radio] Error playing station 2. No URL set!'
        );
        expect(spawn).not.toHaveBeenCalled();
    });

    test('start spawns mpv process with correct args', async () => {
        const url = 'http://example.com/stream';
        presetPort.getValueByPreset.mockReturnValue(url);

        await provider.start(1);

        expect(console.log).toHaveBeenCalledWith(
            '[Internet Radio] Playing internet radio station at ' + url
        );

        expect(spawn).toHaveBeenCalledWith('mpv', [
            url,
            '--no-video',
            '--volume=100',
            '--quiet',
            expect.stringMatching(/^--input-ipc-server=/)
        ]);

        expect(mockProcess.stdout.on).toHaveBeenCalledWith('data', expect.any(Function));
        expect(mockProcess.stderr.on).toHaveBeenCalledWith('data', expect.any(Function));
        expect(mockProcess.on).toHaveBeenCalledWith('exit', expect.any(Function));
    });

    test('reports loading immediately on start, before mpv/IPC connects', async () => {
        const url = 'http://example.com/stream';
        presetPort.getValueByPreset.mockReturnValue(url);
        const callback = jest.fn();
        provider.onNowPlayingChanged(callback);

        await provider.start(1);

        expect(callback).toHaveBeenCalledWith({ loading: true });
    });

    test('forwards icy-title changes from the mpv IPC socket metadata updates', async () => {
        const url = 'http://example.com/stream';
        presetPort.getValueByPreset.mockReturnValue(url);
        const callback = jest.fn();
        provider.onNowPlayingChanged(callback);

        await provider.start(1);

        const connectCb = (net.createConnection as jest.Mock).mock.calls[0][1];
        connectCb();
        expect(mockSocket.write).toHaveBeenCalled();

        const dataHandler = mockSocket.on.mock.calls.find((c: any) => c[0] === 'data')[1];
        dataHandler(Buffer.from(JSON.stringify({ event: 'property-change', name: 'metadata', data: { 'icy-title': 'Artist - Song' } }) + '\n'));

        expect(callback).toHaveBeenCalledWith({ title: 'Artist - Song' });
    });

    // ------------------------
    // STOP
    // ------------------------

    test('stop kills current process if exists', async () => {
        const url = 'http://example.com/stream';
        presetPort.getValueByPreset.mockReturnValue(url);

        await provider.start(1);

        await provider.stop();

        expect(console.log).toHaveBeenCalledWith('[Internet Radio] Stopped internet radio playback!');
        expect(mockProcess.kill).toHaveBeenCalled();
        expect(mockSocket.destroy).toHaveBeenCalled();
        expect((provider as any).currentProcess).toBeUndefined();
    });

    test('stop does nothing if no current process', async () => {
        await provider.stop();

        expect(console.log).not.toHaveBeenCalledWith('[Internet Radio] Stopped internet radio playback!');
        // no error thrown
    });
});
