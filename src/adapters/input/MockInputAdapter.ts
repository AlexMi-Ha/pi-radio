import { InputPort } from "../../core/ports/InputPort";
import readline from "readline";

export class MockInputAdapter implements InputPort {
    private volumeCallback?: (delta: number) => void;
    private volumeMuteCallback?: () => void;
    private modeToggleCallback?: () => void;
    private actionCallback?: () => void;
    private powerCallback?: () => void;

    private rl: readline.Interface;

    constructor() {
        this.rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
        });
    }

    onVolumeChange(callback: (delta: number) => void): void {
        this.volumeCallback = callback;
    }

    onVolumeMute(callback: () => void): void {
        this.volumeMuteCallback = callback;
    }

    onModeToggle(callback: () => void): void {
        this.modeToggleCallback = callback;
    }

    onActionPress(callback: () => void): void {
        this.actionCallback = callback;
    }

    onPowerToggle(callback: () => void): void {
        this.powerCallback = callback;
    }

    start() {
        console.log("[Input] MockInputAdapter started. Type commands:");
        console.log("[Input] 'v <delta>' to change volume (e.g., v 5 or v -3)");
        console.log("[Input] 'm' to press the encoder (toggle mute)");
        console.log("[Input] 't' to toggle mode (internet_radio <-> bluetooth)");
        console.log("[Input] 'a' to press the action button (cycle preset / trigger pairing)");
        console.log("[Input] 'p' to toggle power (idle/active)");

        this.rl.on("line", (line) => {
            const parts = line.trim().split(" ");
            const cmd = parts[0];
            const arg = parts[1];

            switch (cmd) {
                case "v":
                    const delta = parseInt(arg!, 10);
                    if (!isNaN(delta)) this.volumeCallback?.(delta);
                    break;

                case "m":
                    this.volumeMuteCallback?.();
                    break;

                case "t":
                    this.modeToggleCallback?.();
                    break;

                case "a":
                    this.actionCallback?.();
                    break;

                case "p":
                    this.powerCallback?.();
                    break;

                default:
                    console.log("Unknown command. Use v/m/t/a/p.");
            }
        });
    }

    stop() {
        this.rl.close();
    }
}
