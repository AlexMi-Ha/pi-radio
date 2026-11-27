import { exec } from "child_process";
import * as dbus from "@homebridge/dbus-native";
import { Mode } from "../../../core/models/State";
import { AudioProvider } from "../AudioProvider";
import { logger } from "../../../core/util/Logger";

const BLUEZ_SERVICE = "org.bluez";
const DEVICE_IFACE = "org.bluez.Device1";
const MEDIA_PLAYER_IFACE = "org.bluez.MediaPlayer1";
const OBJECT_MANAGER_IFACE = "org.freedesktop.DBus.ObjectManager";
const PROPERTIES_IFACE = "org.freedesktop.DBus.Properties";

// A DBus variant comes back from @homebridge/dbus-native as [signatureTree, [value]],
// never as a plain JS value - see its lib/dbus-buffer.js readVariant/$readProp.
type DbusVariant = [unknown, [unknown]];
type PropsDict = { [prop: string]: DbusVariant };
type ManagedObjects = { [path: string]: { [iface: string]: PropsDict } };

function unwrap(variant: DbusVariant | undefined): any {
    return variant ? variant[1][0] : undefined;
}

type SignalSubscription = { iface: any, event: string, handler: (...args: any[]) => void };

// Tracks live Bluetooth A2DP sink state (device connection + AVRCP track metadata) via
// BlueZ's D-Bus API (org.bluez.Device1 / org.bluez.MediaPlayer1 - see
// https://github.com/bluez/bluez/blob/master/doc/org.bluez.Device.rst and
// org.bluez.MediaPlayer.rst) rather than parsing bluetoothctl's human-oriented text
// output, which has no stable machine-readable format for either of these.
export class BluetoothAudioProvider implements AudioProvider {

    readonly mode: Mode = "bluetooth";

    private bus?: any;
    private connectedDevices = new Set<string>();
    private nowPlayingCallback?: (info: { title?: string, subtitle?: string }) => void;
    private connectionCallback?: (connected: boolean) => void;
    private signalSubscriptions: SignalSubscription[] = [];

    async start(): Promise<void> {
        await this.run("bluetoothctl power on");
        await this.connectDbus();
    }

    async stop(): Promise<void> {
        await this.run("bluetoothctl discoverable off && bluetoothctl pairable off");
        this.disconnectDbus();
    }

    async enablePairing(): Promise<void> {
        await this.run("bluetoothctl discoverable on && bluetoothctl pairable on");
    }

    onNowPlayingChanged(callback: (info: { title?: string, subtitle?: string }) => void): void {
        this.nowPlayingCallback = callback;
    }

    onConnectionChanged(callback: (connected: boolean) => void): void {
        this.connectionCallback = callback;
    }

    // Overridable so tests (and development on a machine with no D-Bus/Bluetooth
    // adapter at all) can supply a fake bus instead of a real system bus connection.
    protected createBus(): any {
        return dbus.systemBus();
    }

    private async connectDbus(): Promise<void> {
        try {
            const bus = this.createBus();
            // An unhandled 'error' on an EventEmitter crashes the process - the system
            // bus socket can fail to connect at any point (e.g. dbus-daemon restarts),
            // well after this initial connect attempt succeeded.
            bus.connection.on("error", (err: Error) =>
                logger.error("[Bluetooth] D-Bus connection error:", err)
            );
            this.bus = bus;

            const objectManager = await this.getInterface("/", OBJECT_MANAGER_IFACE);
            const objects = await this.callMethod<ManagedObjects>(objectManager, "GetManagedObjects");
            for (const path of Object.keys(objects)) {
                await this.trackObject(path, objects[path]!);
            }

            const addedHandler = (path: string, interfaces: { [iface: string]: PropsDict }) => {
                this.trackObject(path, interfaces).catch((err) =>
                    logger.error("[Bluetooth] Failed to track new D-Bus object:", err)
                );
            };
            objectManager.on("InterfacesAdded", addedHandler);
            this.signalSubscriptions.push({ iface: objectManager, event: "InterfacesAdded", handler: addedHandler });
        } catch (err) {
            // No D-Bus/BlueZ available (e.g. a dev machine with no Bluetooth adapter, or
            // bluetoothd not running) - pairing itself still works via bluetoothctl above;
            // AVRCP metadata and live connection tracking are simply unavailable.
            logger.error("[Bluetooth] D-Bus connection unavailable, live status disabled:", err);
        }
    }

    private disconnectDbus(): void {
        for (const { iface, event, handler } of this.signalSubscriptions) {
            iface.removeListener(event, handler);
        }
        this.signalSubscriptions = [];
        this.connectedDevices.clear();
        this.bus?.connection.end();
        this.bus = undefined;
    }

    private async trackObject(path: string, interfaces: { [iface: string]: PropsDict }): Promise<void> {
        if (!this.bus) {
            return;
        }
        const hasDevice = !!interfaces[DEVICE_IFACE];
        const hasMediaPlayer = !!interfaces[MEDIA_PLAYER_IFACE];
        if (!hasDevice && !hasMediaPlayer) {
            return;
        }

        if (hasDevice && unwrap(interfaces[DEVICE_IFACE]!["Connected"])) {
            this.connectedDevices.add(path);
            this.connectionCallback?.(true);
        }
        if (hasMediaPlayer) {
            this.reportTrack(interfaces[MEDIA_PLAYER_IFACE]!["Track"]);
        }

        const properties = await this.getInterface(path, PROPERTIES_IFACE);
        const handler = (changedIface: string, changed: PropsDict) => {
            if (changedIface == DEVICE_IFACE && "Connected" in changed) {
                if (unwrap(changed["Connected"])) {
                    this.connectedDevices.add(path);
                } else {
                    this.connectedDevices.delete(path);
                }
                this.connectionCallback?.(this.connectedDevices.size > 0);
            } else if (changedIface == MEDIA_PLAYER_IFACE && "Track" in changed) {
                this.reportTrack(changed["Track"]);
            }
        };
        properties.on("PropertiesChanged", handler);
        this.signalSubscriptions.push({ iface: properties, event: "PropertiesChanged", handler });
    }

    private reportTrack(trackVariant: DbusVariant | undefined): void {
        const track = unwrap(trackVariant) as PropsDict | undefined;
        if (!track) {
            return;
        }
        this.nowPlayingCallback?.({
            title: unwrap(track["Title"]),
            subtitle: unwrap(track["Artist"])
        });
    }

    private getInterface(path: string, iface: string): Promise<any> {
        return new Promise((resolve, reject) => {
            this.bus.getService(BLUEZ_SERVICE).getInterface(path, iface, (err: Error | null, obj: any) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(obj);
                }
            });
        });
    }

    private callMethod<T>(iface: any, method: string, ...args: any[]): Promise<T> {
        return new Promise((resolve, reject) => {
            iface[method](...args, (err: Error | null, result: T) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(result);
                }
            });
        });
    }

    // bluetoothctl can hang indefinitely (e.g. no adapter/dbus available) instead of
    // erroring out. Since mode switches are serialized through a single AsyncProcessor,
    // a hung command here would wedge it forever and the radio could never switch modes
    // again - the timeout guarantees this always resolves or rejects.
    private run(command: string): Promise<void> {
        return new Promise((resolve, reject) => {
            exec(command, { timeout: 5000 }, (err, stdout, stderr) => {
                if(err) {
                    logger.error(
                        `[Bluetooth] Command failed: ${command} stdout=${(stdout ?? "").trim()} stderr=${(stderr ?? "").trim()}`,
                        err
                    );
                    reject(err);
                }else {
                    resolve();
                }
            });
        });
    }
}
