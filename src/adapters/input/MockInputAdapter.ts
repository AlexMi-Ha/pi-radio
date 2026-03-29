import { Mode } from "../../core/models/State";
import { InputPort } from "../../core/ports/InputPort";
import readline from "readline";

export class MockInputAdapter implements InputPort {
    private volumeCallback?: (delta: number) => void;
    private modeCallback?: (mode: Mode) => void;
    private presetCallback?: (id: number) => void;
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

    onModeSelect(callback: (mode: Mode) => void): void {
        this.modeCallback = callback;
    }

    onPresetSelect(callback: (id: number) => void): void {
        this.presetCallback = callback;
    }

    onPowerToggle(callback: () => void): void {
        this.powerCallback = callback;
    }

    start() {
        console.log("[Input] MockInputAdapter started. Type commands:");
        console.log("[Input] 'v <delta>' to change volume (e.g., v 5 or v -3)");
        console.log("[Input] 'm <mode>' to change mode (e.g., m internet_radio)");
        console.log("[Input] 'f <id>' to press preset button (e.g., f 1)");
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
                    if (arg == "internet_radio" || arg == "fm" || arg == "bluetooth" || arg == "spotify") this.modeCallback?.(arg);
                    break;

                case "f":
                    const id = parseInt(arg!, 10);
                    if (!isNaN(id)) this.presetCallback?.(id);
                    break;

                case "p":
                    this.powerCallback?.();
                    break;

                default:
                    console.log("Unknown command. Use v/m/f/p.");
            }
        });
    }

    stop() {
        this.rl.close();
    }
}