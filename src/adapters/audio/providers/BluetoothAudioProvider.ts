import { exec } from "child_process";
import { Mode } from "../../../core/models/State";
import { AudioProvider } from "../AudioProvider";

// Minimal Bluetooth A2DP sink control via bluetoothctl. AVRCP track metadata
// (artist/title) requires talking to BlueZ's MediaPlayer1 D-Bus interface and
// is left as follow-up work - there's no hardware to develop/test it against yet,
// so onNowPlayingChanged is intentionally never invoked here.
export class BluetoothAudioProvider implements AudioProvider {

    readonly mode: Mode = "bluetooth";

    async start(): Promise<void> {
        await this.run("bluetoothctl power on");
    }

    async stop(): Promise<void> {
        await this.run("bluetoothctl discoverable off && bluetoothctl pairable off");
    }

    async enablePairing(): Promise<void> {
        await this.run("bluetoothctl discoverable on && bluetoothctl pairable on");
    }

    // bluetoothctl can hang indefinitely (e.g. no adapter/dbus available) instead of
    // erroring out. Since mode switches are serialized through a single AsyncProcessor,
    // a hung command here would wedge it forever and the radio could never switch modes
    // again - the timeout guarantees this always resolves or rejects.
    private run(command: string): Promise<void> {
        return new Promise((resolve, reject) => {
            exec(command, { timeout: 5000 }, (err) => {
                if(err) {
                    console.error("[Bluetooth] Command failed: " + command, err);
                    reject(err);
                }else {
                    resolve();
                }
            });
        });
    }
}
