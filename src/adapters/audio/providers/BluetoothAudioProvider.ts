import { exec, spawn, ChildProcess } from "child_process";
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

// @homebridge/dbus-native decodes every D-Bus dict container (a{sv}, a{sa{sv}},
// a{oa{sa{sv}}}, ...) as a plain array of [key, value] pairs - see its
// lib/dbus-buffer.js readStruct/readArray, which never produces a keyed JS
// object for a '{' (dict entry) type, only nested arrays. Confirmed live
// against a real BlueZ/bluetoothd (no Bluetooth hardware was available when
// this file was first written - see deploy/README.md's caveat about that):
// GetManagedObjects came back with numeric array-index keys ("0","1","2")
// instead of object paths, and InterfacesAdded/PropertiesChanged payloads
// never matched any interface/property name lookup, silently leaving
// `connected` stuck at false forever. Every dict-shaped value read off the
// bus has to go through this conversion before any [key] access is valid.
type Pairs<V> = [string, V][];

function pairsToObject<V>(pairs: Pairs<V>): { [key: string]: V } {
    const obj: { [key: string]: V } = {};
    for (const [key, value] of pairs) {
        obj[key] = value;
    }
    return obj;
}

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
    private nowPlayingCallback?: (info: { title?: string, subtitle?: string, loading?: boolean }) => void;
    private connectionCallback?: (connected: boolean) => void;
    private signalSubscriptions: SignalSubscription[] = [];
    private agentProcess: ChildProcess | undefined;
    private audioSinkProcess: ChildProcess | undefined;

    async start(): Promise<void> {
        await this.run("bluetoothctl power on");
        this.startAgent();
        this.startAudioSink();
        await this.connectDbus();
    }

    async stop(): Promise<void> {
        // Mirrors start()'s "power on" - without this the radio (and so
        // discoverability to other devices, and its own idle power draw)
        // stays on indefinitely after leaving bluetooth mode, even though
        // start() always turns it back on the next time this mode is entered.
        await this.run("bluetoothctl discoverable off && bluetoothctl pairable off && bluetoothctl power off");
        this.disconnectDbus();
        this.stopAgent();
        this.stopAudioSink();
    }

    async enablePairing(): Promise<void> {
        await this.run("bluetoothctl discoverable on && bluetoothctl pairable on");
    }

    onNowPlayingChanged(callback: (info: { title?: string, subtitle?: string, loading?: boolean }) => void): void {
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

    // Overridable so tests can observe/replace the two long-lived child processes
    // below without actually spawning bluetoothctl/bluealsa-aplay.
    protected spawnProcess(command: string, args: string[], captureStdout: boolean = false): ChildProcess {
        return spawn(command, args, { stdio: ["pipe", captureStdout ? "pipe" : "ignore", "ignore"] });
    }

    // bluetoothctl's own one-shot `exec` invocations above (enablePairing etc.)
    // exit immediately and never register a BlueZ pairing agent - with no agent,
    // a phone's pairing/bonding request has no responder and can stall forever,
    // leaving the "Pairing" UI state stuck. Keeping an interactive bluetoothctl
    // process alive for the whole time bluetooth mode is active registers a
    // NoInputNoOutput ("Just Works") agent as BlueZ's default, so bonding
    // requests are accepted automatically instead of waiting on nothing.
    //
    // Registration itself goes through the `--agent` startup flag rather than
    // typing "agent NoInputNoOutput" into stdin after the fact - confirmed via
    // a live BlueZ HCI trace (btmon) that the stdin-typed form is racy: it can
    // lose to the pairing request already in flight, leaving some *other*
    // capability (observed: DisplayYesNo) in effect, which makes a phone show
    // a numeric-comparison code that nothing on this end ever confirms, and
    // the pairing then times out after ~30s. "default-agent" still has to be
    // sent after startup finishes, so wait for bluetoothctl's own "Agent
    // registered" line on stdout rather than guessing a fixed delay - sending
    // it too early reliably fails with "No agent is registered" (reproduced
    // manually while debugging this).
    private startAgent(): void {
        this.agentProcess = this.spawnProcess("bluetoothctl", ["--agent", "NoInputNoOutput"], true);
        this.agentProcess.on("error", (err) =>
            logger.error("[Bluetooth] Agent process failed to start:", err)
        );
        const onStdout = (chunk: Buffer) => {
            if (chunk.toString().includes("Agent registered")) {
                this.agentProcess?.stdout?.off("data", onStdout);
                this.agentProcess?.stdin?.write("default-agent\n");
            }
        };
        this.agentProcess.stdout?.on("data", onStdout);
    }

    private stopAgent(): void {
        this.agentProcess?.kill();
        this.agentProcess = undefined;
    }

    // Pairing/connection alone only gets BlueZ to accept the A2DP sink profile -
    // something still has to pull the decoded PCM audio out of BlueALSA and into
    // ALSA, or the phone has nowhere to send it and just keeps playing locally.
    // bluealsa-aplay (from the bluez-alsa-utils package, see deploy/remote-setup.sh)
    // does that; "00:00:00:00:00:00" tells it to accept audio from whichever
    // device is currently connected rather than one fixed MAC.
    private startAudioSink(): void {
        this.audioSinkProcess = this.spawnProcess("bluealsa-aplay", ["00:00:00:00:00:00"]);
        this.audioSinkProcess.on("error", (err) =>
            logger.error("[Bluetooth] bluealsa-aplay failed to start (is bluez-alsa-utils installed?):", err)
        );
    }

    private stopAudioSink(): void {
        this.audioSinkProcess?.kill();
        this.audioSinkProcess = undefined;
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
            const rawObjects = await this.callMethod<Pairs<Pairs<Pairs<DbusVariant>>>>(objectManager, "GetManagedObjects");
            const objects: ManagedObjects = pairsToObject(
                rawObjects.map(([path, rawInterfaces]) => [path, this.toInterfaces(rawInterfaces)])
            );
            for (const path of Object.keys(objects)) {
                await this.trackObject(path, objects[path]!);
            }

            const addedHandler = (path: string, rawInterfaces: Pairs<Pairs<DbusVariant>>) => {
                this.trackObject(path, this.toInterfaces(rawInterfaces)).catch((err) =>
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

    // Converts the raw array-of-pairs shape dbus-native hands back for a dict
    // of interfaces (a{sa{sv}}) into the plain keyed object the rest of this
    // class works with - see the Pairs<V>/pairsToObject comment above.
    private toInterfaces(rawInterfaces: Pairs<Pairs<DbusVariant>>): { [iface: string]: PropsDict } {
        return pairsToObject(rawInterfaces.map(([iface, rawProps]) => [iface, pairsToObject(rawProps)]));
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
        // Requesting Connect() (see ensureProfilesConnected) before BlueZ has
        // finished SDP service discovery on this device gets rejected with
        // "org.bluez.Error.Failed br-connection-refused" (confirmed live) -
        // ServicesResolved is BlueZ's own signal that discovery finished, so
        // it's the correct gate, not a Connected check or a guessed delay.
        if (hasDevice && unwrap(interfaces[DEVICE_IFACE]!["ServicesResolved"])) {
            this.ensureProfilesConnected(path);
        }
        if (hasMediaPlayer) {
            this.reportTrack(interfaces[MEDIA_PLAYER_IFACE]!["Track"]);
        }

        const properties = await this.getInterface(path, PROPERTIES_IFACE);
        const handler = (changedIface: string, rawChanged: Pairs<DbusVariant>) => {
            const changed = pairsToObject(rawChanged);
            if (changedIface == DEVICE_IFACE && "Connected" in changed) {
                if (unwrap(changed["Connected"])) {
                    this.connectedDevices.add(path);
                } else {
                    this.connectedDevices.delete(path);
                }
                this.connectionCallback?.(this.connectedDevices.size > 0);
            }
            if (changedIface == DEVICE_IFACE && "ServicesResolved" in changed && unwrap(changed["ServicesResolved"])) {
                this.ensureProfilesConnected(path);
            }
            if (changedIface == MEDIA_PLAYER_IFACE && "Track" in changed) {
                this.reportTrack(changed["Track"]);
            }
        };
        properties.on("PropertiesChanged", handler);
        this.signalSubscriptions.push({ iface: properties, event: "PropertiesChanged", handler });
    }

    // Device1.Connected only reflects the base ACL link coming up during
    // bonding - it does NOT mean the A2DP/AVRCP profiles this app actually
    // needs have been negotiated. Phones (confirmed on iOS) don't reliably
    // request those profiles themselves right after bonding; nothing else in
    // this codebase ever asked BlueZ to connect them, which is exactly why a
    // device could show up "Paired: yes, Connected: yes" while
    // `bluealsa-cli list-pcms` stayed empty and no audio ever routed anywhere.
    // Explicitly requesting a full connect (which negotiates every profile
    // BlueZ has registered for this device, A2DP included) fixes that -
    // confirmed manually on real hardware while debugging this. Trusting the
    // device first also makes BlueZ auto-reconnect those same profiles on
    // future reconnects without needing this again.
    private ensureProfilesConnected(path: string): void {
        const match = path.match(/dev_([0-9A-Fa-f_]+)$/);
        if (!match) {
            return;
        }
        const address = match[1]!.replace(/_/g, ":");
        this.run(`bluetoothctl trust ${address} && bluetoothctl connect ${address}`).catch((err) =>
            logger.error(`[Bluetooth] Failed to request profile connection for ${address}:`, err)
        );
    }

    private reportTrack(trackVariant: DbusVariant | undefined): void {
        const rawTrack = unwrap(trackVariant) as Pairs<DbusVariant> | undefined;
        if (!rawTrack) {
            return;
        }
        const track = pairsToObject(rawTrack);
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
