import { BluetoothAudioProvider } from '../../../../src/adapters/audio/providers/BluetoothAudioProvider';
import { exec } from 'child_process';

jest.mock('child_process', () => ({
    exec: jest.fn()
}));

describe('BluetoothAudioProvider', () => {
    let provider: BluetoothAudioProvider;

    beforeEach(() => {
        jest.clearAllMocks();
        provider = new BluetoothAudioProvider();
        jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('start runs bluetoothctl with a timeout so a hung command cannot block forever', async () => {
        (exec as unknown as jest.Mock).mockImplementation((command, options, callback) => {
            callback(null);
        });

        await provider.start();

        expect(exec).toHaveBeenCalledWith(
            'bluetoothctl power on',
            expect.objectContaining({ timeout: expect.any(Number) }),
            expect.any(Function)
        );
    });

    test('start rejects if bluetoothctl errors (e.g. after its exec timeout fires)', async () => {
        (exec as unknown as jest.Mock).mockImplementation((command, options, callback) => {
            callback(new Error('ETIMEDOUT'));
        });

        await expect(provider.start()).rejects.toThrow('ETIMEDOUT');
    });
});
