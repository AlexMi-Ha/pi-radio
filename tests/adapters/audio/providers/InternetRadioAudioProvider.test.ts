import { InternetRadioAudioProvider } from '../../../../src/adapters/audio/providers/InternetRadioAudioProvider';
import { PresetPort } from '../../../../src/core/ports/PresetPort';
import { spawn, ChildProcessWithoutNullStreams } from 'child_process';

jest.mock('child_process', () => ({
    spawn: jest.fn()
}));

describe('InternetRadioAudioProvider', () => {
    let presetPort: any;
    let provider: InternetRadioAudioProvider;
    let mockProcess: any;

    beforeEach(() => {
        mockProcess = {
            stdout: { on: jest.fn() },
            stderr: { on: jest.fn() },
            on: jest.fn(),
            kill: jest.fn()
        };

        (spawn as jest.Mock).mockReturnValue(mockProcess);

        presetPort = {
            getMaxPresetIndex: jest.fn().mockReturnValue(5),
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
            '--quiet'
        ]);

        expect(mockProcess.stdout.on).toHaveBeenCalledWith('data', expect.any(Function));
        expect(mockProcess.stderr.on).toHaveBeenCalledWith('data', expect.any(Function));
        expect(mockProcess.on).toHaveBeenCalledWith('exit', expect.any(Function));
    });

    // ------------------------
    // STOP
    // ------------------------

    test('stop kills current process if exists', async () => {
        const url = 'http://example.com/stream';
        presetPort.getValueByPreset.mockReturnValue(url);

        await provider.start(1);

        await provider.stop();

        expect(console.log).toHaveBeenCalledWith('[Internet Radio] Stopping internet radio playback!');
        expect(mockProcess.kill).toHaveBeenCalled();
        expect((provider as any).currentProcess).toBeUndefined();
    });

    test('stop does nothing if no current process', async () => {
        await provider.stop();

        expect(console.log).not.toHaveBeenCalledWith('[Internet Radio] Stopping internet radio playback!');
        // no error thrown
    });
});