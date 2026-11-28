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

// @homebridge/dbus-native decodes every D-Bus dict container as an array of
// [key, value] pairs, never as a plain JS object (confirmed against its own
// lib/dbus-buffer.js - see BluetoothAudioProvider's pairsToObject comment).
// These fixtures build GetManagedObjects/InterfacesAdded/PropertiesChanged
// payloads in that real shape, not the plain-object shape the code used to
// (wrongly) assume - a real BlueZ reply never matches a `{ foo: ... }`
// fixture, which is exactly how the "connected" bug this was written to
// catch stayed invisible to the test suite.
type RawProps = [string, any][];
type RawInterfaces = [string, RawProps][];

function deviceInterfaces(connected: boolean, servicesResolved: boolean = false): RawInterfaces {
    return [['org.bluez.Device1', [['Connected', variant(connected)], ['ServicesResolved', variant(servicesResolved)]]]];
}

function mediaPlayerInterfaces(title?: string, artist?: string): RawInterfaces {
    const track: RawProps = [];
    if (title !== undefined) track.push(['Title', variant(title)]);
    if (artist !== undefined) track.push(['Artist', variant(artist)]);
    return [['org.bluez.MediaPlayer1', [['Track', variant(track)]]]];
}

class FakeBus {
    connection = Object.assign(new EventEmitter(), { end: jest.fn() });
    objectManager = Object.assign(new EventEmitter(), {
        GetManagedObjects: jest.fn((cb: any) => cb(null, []))
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

    propertiesChanged(path: string, iface: string, changed: RawProps) {
        this.propertiesByPath.get(path)?.emit('PropertiesChanged', iface, changed, []);
    }
}

class FakeChildProcess extends EventEmitter {
    stdin = { write: jest.fn() };
    stdout = new EventEmitter();
    kill = jest.fn();
}

class TestableBluetoothAudioProvider extends BluetoothAudioProvider {
    fakeBus = new FakeBus();
    spawnedProcesses: { command: string, args: string[], process: FakeChildProcess }[] = [];

    protected createBus() {
        return this.fakeBus;
    }

    protected spawnProcess(command: string, args: string[], captureStdout: boolean = false): any {
        const process = new FakeChildProcess();
        this.spawnedProcesses.push({ command, args, process });
        return process;
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
                cb(null, [['/org/bluez/hci0/dev_AA', deviceInterfaces(true)]])
            );
            const connectionCallback = jest.fn();
            provider.onConnectionChanged(connectionCallback);

            await provider.start();

            expect(connectionCallback).toHaveBeenCalledWith(true);
        });

        test('requests trust+connect once ServicesResolved is true, to force profile (A2DP) negotiation', async () => {
            provider.fakeBus.objectManager.GetManagedObjects.mockImplementation((cb: any) =>
                cb(null, [['/org/bluez/hci0/dev_AA_BB_CC_DD_EE_FF', deviceInterfaces(true, true)]])
            );

            await provider.start();

            expect(exec).toHaveBeenCalledWith(
                'bluetoothctl trust AA:BB:CC:DD:EE:FF && bluetoothctl connect AA:BB:CC:DD:EE:FF',
                expect.objectContaining({ timeout: expect.any(Number) }),
                expect.any(Function)
            );
        });

        test('does not request trust+connect before ServicesResolved becomes true', async () => {
            provider.fakeBus.objectManager.GetManagedObjects.mockImplementation((cb: any) =>
                cb(null, [['/org/bluez/hci0/dev_AA_BB_CC_DD_EE_FF', deviceInterfaces(true, false)]])
            );

            await provider.start();
            expect(exec).not.toHaveBeenCalledWith(
                expect.stringContaining('bluetoothctl connect'),
                expect.anything(),
                expect.anything()
            );

            provider.fakeBus.propertiesChanged('/org/bluez/hci0/dev_AA_BB_CC_DD_EE_FF', 'org.bluez.Device1', [
                ['ServicesResolved', variant(true)]
            ]);

            expect(exec).toHaveBeenCalledWith(
                'bluetoothctl trust AA:BB:CC:DD:EE:FF && bluetoothctl connect AA:BB:CC:DD:EE:FF',
                expect.objectContaining({ timeout: expect.any(Number) }),
                expect.any(Function)
            );
        });

        test('reports track metadata found at startup', async () => {
            provider.fakeBus.objectManager.GetManagedObjects.mockImplementation((cb: any) =>
                cb(null, [['/org/bluez/hci0/dev_AA/player0', mediaPlayerInterfaces('Song', 'Artist')]])
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
                cb(null, [['/org/bluez/hci0/dev_AA', deviceInterfaces(true)]])
            );
            const connectionCallback = jest.fn();
            provider.onConnectionChanged(connectionCallback);

            await provider.start();
            provider.fakeBus.propertiesChanged('/org/bluez/hci0/dev_AA', 'org.bluez.Device1', [['Connected', variant(false)]]);

            expect(connectionCallback).toHaveBeenLastCalledWith(false);
        });

        test('reports updated track metadata via PropertiesChanged', async () => {
            provider.fakeBus.objectManager.GetManagedObjects.mockImplementation((cb: any) =>
                cb(null, [['/org/bluez/hci0/dev_AA/player0', mediaPlayerInterfaces('Old Song')]])
            );
            const nowPlayingCallback = jest.fn();
            provider.onNowPlayingChanged(nowPlayingCallback);

            await provider.start();
            provider.fakeBus.propertiesChanged('/org/bluez/hci0/dev_AA/player0', 'org.bluez.MediaPlayer1', [
                ['Track', variant([['Title', variant('New Song')], ['Artist', variant('New Artist')]])]
            ]);

            expect(nowPlayingCallback).toHaveBeenLastCalledWith({ title: 'New Song', subtitle: 'New Artist' });
        });

        test('stop tears down D-Bus listeners and the connection', async () => {
            provider.fakeBus.objectManager.GetManagedObjects.mockImplementation((cb: any) =>
                cb(null, [['/org/bluez/hci0/dev_AA', deviceInterfaces(true)]])
            );
            const connectionCallback = jest.fn();
            provider.onConnectionChanged(connectionCallback);

            await provider.start();
            await provider.stop();

            connectionCallback.mockClear();
            provider.fakeBus.propertiesChanged('/org/bluez/hci0/dev_AA', 'org.bluez.Device1', [['Connected', variant(false)]]);

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

    test('start registers a NoInputNoOutput pairing agent via the bluetoothctl --agent flag', async () => {
        (exec as unknown as jest.Mock).mockImplementation((command, options, callback) => callback(null));

        await provider.start();

        const agent = provider.spawnedProcesses.find((p) => p.command === 'bluetoothctl');
        expect(agent).toBeDefined();
        expect(agent!.args).toEqual(['--agent', 'NoInputNoOutput']);
    });

    test('marks the agent default only once bluetoothctl confirms its own registration', async () => {
        (exec as unknown as jest.Mock).mockImplementation((command, options, callback) => callback(null));

        await provider.start();
        const agent = provider.spawnedProcesses.find((p) => p.command === 'bluetoothctl')!;

        expect(agent.process.stdin.write).not.toHaveBeenCalled();

        agent.process.stdout.emit('data', Buffer.from('Agent registered'));

        expect(agent.process.stdin.write).toHaveBeenCalledWith('default-agent\n');
    });

    test('start spawns bluealsa-aplay to route connected-device audio into ALSA', async () => {
        (exec as unknown as jest.Mock).mockImplementation((command, options, callback) => callback(null));

        await provider.start();

        const sink = provider.spawnedProcesses.find((p) => p.command === 'bluealsa-aplay');
        expect(sink).toBeDefined();
        expect(sink!.args).toEqual(['00:00:00:00:00:00']);
    });

    test('stop kills the agent and audio sink processes', async () => {
        (exec as unknown as jest.Mock).mockImplementation((command, options, callback) => callback(null));

        await provider.start();
        await provider.stop();

        for (const { process } of provider.spawnedProcesses) {
            expect(process.kill).toHaveBeenCalled();
        }
    });
});
