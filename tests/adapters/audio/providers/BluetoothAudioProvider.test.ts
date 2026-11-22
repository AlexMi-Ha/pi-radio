import { EventEmitter } from 'events';
import { exec } from 'child_process';
import { BluetoothAudioProvider } from '../../../../src/adapters/audio/providers/BluetoothAudioProvider';

jest.mock('child_process', () => ({
    exec: jest.fn()
}));

// A DBus variant as returned by @homebridge/dbus-native: [signatureTree, [value]].
function variant(value: any): any {
    return [{}, [value]];
}

function deviceInterfaces(connected: boolean) {
    return { 'org.bluez.Device1': { Connected: variant(connected) } };
}

function mediaPlayerInterfaces(title?: string, artist?: string) {
    const track: any = {};
    if (title !== undefined) track.Title = variant(title);
    if (artist !== undefined) track.Artist = variant(artist);
    return { 'org.bluez.MediaPlayer1': { Track: variant(track) } };
}

class FakeBus {
    connection = Object.assign(new EventEmitter(), { end: jest.fn() });
    objectManager = Object.assign(new EventEmitter(), {
        GetManagedObjects: jest.fn((cb: any) => cb(null, {}))
    });
    propertiesByPath = new Map<string, EventEmitter>();

    getService() {
        return {
            getInterface: (path: string, iface: string, cb: any) => {
                if (iface === 'org.freedesktop.DBus.ObjectManager') {
                    cb(null, this.objectManager);
                    return;
                }
                if (!this.propertiesByPath.has(path)) {
                    this.propertiesByPath.set(path, new EventEmitter());
                }
                cb(null, this.propertiesByPath.get(path));
            }
        };
    }

    propertiesChanged(path: string, iface: string, changed: any) {
        this.propertiesByPath.get(path)?.emit('PropertiesChanged', iface, changed, []);
    }
}

class TestableBluetoothAudioProvider extends BluetoothAudioProvider {
    fakeBus = new FakeBus();

    protected createBus() {
        return this.fakeBus;
    }
}

describe('BluetoothAudioProvider', () => {
    let provider: TestableBluetoothAudioProvider;

    beforeEach(() => {
        jest.clearAllMocks();
        provider = new TestableBluetoothAudioProvider();
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

    test('start does not throw if D-Bus is unavailable (e.g. no bluetoothd on this machine)', async () => {
        (exec as unknown as jest.Mock).mockImplementation((command, options, callback) => callback(null));
        provider.fakeBus.objectManager.GetManagedObjects.mockImplementation((cb: any) =>
            cb(new Error('The name org.bluez was not provided'))
        );

        await expect(provider.start()).resolves.toBeUndefined();
        expect(console.error).toHaveBeenCalled();
    });

    describe('with D-Bus connected', () => {
        beforeEach(() => {
            (exec as unknown as jest.Mock).mockImplementation((command, options, callback) => callback(null));
        });

        test('reports an already-connected device found at startup', async () => {
            provider.fakeBus.objectManager.GetManagedObjects.mockImplementation((cb: any) =>
                cb(null, { '/org/bluez/hci0/dev_AA': deviceInterfaces(true) })
            );
            const connectionCallback = jest.fn();
            provider.onConnectionChanged(connectionCallback);

            await provider.start();

            expect(connectionCallback).toHaveBeenCalledWith(true);
        });

        test('reports track metadata found at startup', async () => {
            provider.fakeBus.objectManager.GetManagedObjects.mockImplementation((cb: any) =>
                cb(null, { '/org/bluez/hci0/dev_AA/player0': mediaPlayerInterfaces('Song', 'Artist') })
            );
            const nowPlayingCallback = jest.fn();
            provider.onNowPlayingChanged(nowPlayingCallback);

            await provider.start();

            expect(nowPlayingCallback).toHaveBeenCalledWith({ title: 'Song', subtitle: 'Artist' });
        });

        test('reports a newly-connected device via InterfacesAdded', async () => {
            const connectionCallback = jest.fn();
            provider.onConnectionChanged(connectionCallback);

            await provider.start();
            provider.fakeBus.objectManager.emit('InterfacesAdded', '/org/bluez/hci0/dev_AA', deviceInterfaces(true));
            await Promise.resolve();
            await Promise.resolve();

            expect(connectionCallback).toHaveBeenCalledWith(true);
        });

        test('reports disconnection via PropertiesChanged once all devices disconnect', async () => {
            provider.fakeBus.objectManager.GetManagedObjects.mockImplementation((cb: any) =>
                cb(null, { '/org/bluez/hci0/dev_AA': deviceInterfaces(true) })
            );
            const connectionCallback = jest.fn();
            provider.onConnectionChanged(connectionCallback);

            await provider.start();
            provider.fakeBus.propertiesChanged('/org/bluez/hci0/dev_AA', 'org.bluez.Device1', { Connected: variant(false) });

            expect(connectionCallback).toHaveBeenLastCalledWith(false);
        });

        test('reports updated track metadata via PropertiesChanged', async () => {
            provider.fakeBus.objectManager.GetManagedObjects.mockImplementation((cb: any) =>
                cb(null, { '/org/bluez/hci0/dev_AA/player0': mediaPlayerInterfaces('Old Song') })
            );
            const nowPlayingCallback = jest.fn();
            provider.onNowPlayingChanged(nowPlayingCallback);

            await provider.start();
            provider.fakeBus.propertiesChanged('/org/bluez/hci0/dev_AA/player0', 'org.bluez.MediaPlayer1', {
                Track: variant({ Title: variant('New Song'), Artist: variant('New Artist') })
            });

            expect(nowPlayingCallback).toHaveBeenLastCalledWith({ title: 'New Song', subtitle: 'New Artist' });
        });

        test('stop tears down D-Bus listeners and the connection', async () => {
            provider.fakeBus.objectManager.GetManagedObjects.mockImplementation((cb: any) =>
                cb(null, { '/org/bluez/hci0/dev_AA': deviceInterfaces(true) })
            );
            const connectionCallback = jest.fn();
            provider.onConnectionChanged(connectionCallback);

            await provider.start();
            await provider.stop();

            connectionCallback.mockClear();
            provider.fakeBus.propertiesChanged('/org/bluez/hci0/dev_AA', 'org.bluez.Device1', { Connected: variant(false) });

            expect(connectionCallback).not.toHaveBeenCalled();
        });
    });

    test('enablePairing runs bluetoothctl discoverable/pairable on', async () => {
        (exec as unknown as jest.Mock).mockImplementation((command, options, callback) => callback(null));

        await provider.enablePairing();

        expect(exec).toHaveBeenCalledWith(
            'bluetoothctl discoverable on && bluetoothctl pairable on',
            expect.objectContaining({ timeout: expect.any(Number) }),
            expect.any(Function)
        );
    });
});
