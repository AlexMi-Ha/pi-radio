import { ChildProcessWithoutNullStreams, spawn } from "child_process";
import * as readline from "readline";
import { InputPort } from "../../core/ports/InputPort";
import { logger } from "../../core/util/Logger";

export interface GpioInputAdapterOptions {
    powerButtonPin: number;
    modeButtonPin: number;
    actionButtonPin: number;
    encoderAPin: number;
    encoderBPin: number;
    encoderButtonPin: number;
    buttonDebounceMs?: number;
    volumeStepPerDetent?: number;
    gpioChip?: string;
}

// Quadrature decoding: pinState is the 2-bit reading (A<<1|B), which walks
// one of two Gray-code cycles as the encoder turns:
//   clockwise:        0 -> 1 -> 3 -> 2 -> 0
//   counter-clockwise: 0 -> 2 -> 3 -> 1 -> 0
// STEP[prevPinState * 4 + newPinState] gives the per-edge contribution for
// each *legal* (single-bit) transition along either cycle; anything else
// (no change, or an illegal two-bit jump from contact bounce) contributes 0.
// A full detent is 4 edges (one full lap of either cycle), so edges
// accumulate until the magnitude reaches 4, at which point one callback
// fires and the accumulator resets - transient bounce that doesn't add up
// to a full lap never produces a spurious callback.
const STEPS_PER_DETENT = 4;
const QUADRATURE_STEP: number[] = new Array(16).fill(0);
QUADRATURE_STEP[0 * 4 + 1] = 1;
QUADRATURE_STEP[1 * 4 + 3] = 1;
QUADRATURE_STEP[3 * 4 + 2] = 1;
QUADRATURE_STEP[2 * 4 + 0] = 1;
QUADRATURE_STEP[0 * 4 + 2] = -1;
QUADRATURE_STEP[2 * 4 + 3] = -1;
QUADRATURE_STEP[3 * 4 + 1] = -1;
QUADRATURE_STEP[1 * 4 + 0] = -1;

// Talks to GPIO via libgpiod's `gpiomon` CLI tool (spawned as a child
// process) rather than a native binding or the legacy /sys/class/gpio sysfs
// interface - sysfs GPIO was removed from mainline Linux in kernel 6.3, and
// native libgpiod Node bindings available at the time this was written
// don't support libgpiod 2.x (what current Raspberry Pi OS ships). Shelling
// out to the CLI tools that ship with whatever libgpiod version is actually
// installed sidesteps that version-lock entirely - this mirrors
// BluetoothAudioProvider's `bluetoothctl`-based approach elsewhere in the
// adapter layer.
export class GpioInputAdapter implements InputPort {
    private volumeCallback?: (delta: number) => void;
    private volumeMuteCallback?: () => void;
    private modeToggleCallback?: () => void;
    private actionCallback?: () => void;
    private powerCallback?: () => void;

    private readonly chip: string;
    private readonly buttonDebounceMs: number;
    private readonly volumeStepPerDetent: number;

    private readonly powerPin: number;
    private readonly modePin: number;
    private readonly actionPin: number;
    private readonly encoderAPin: number;
    private readonly encoderBPin: number;
    private readonly encoderBtnPin: number;

    private buttonMonitor?: ChildProcessWithoutNullStreams;
    private encoderMonitor?: ChildProcessWithoutNullStreams;

    // Quadrature decoder state (see QUADRATURE_STEP above). gpiomon reports
    // edges, not levels, so each pin's current level is tracked
    // incrementally from the edge type rather than read on demand.
    private encoderALevel: 0 | 1 = 0;
    private encoderBLevel: 0 | 1 = 0;
    private lastPinState = 0;
    private accumulator = 0;

    constructor(options: GpioInputAdapterOptions) {
        this.chip = options.gpioChip ?? "gpiochip0";
        this.buttonDebounceMs = options.buttonDebounceMs ?? 25;
        this.volumeStepPerDetent = options.volumeStepPerDetent ?? 1;

        this.powerPin = options.powerButtonPin;
        this.modePin = options.modeButtonPin;
        this.actionPin = options.actionButtonPin;
        this.encoderAPin = options.encoderAPin;
        this.encoderBPin = options.encoderBPin;
        this.encoderBtnPin = options.encoderButtonPin;
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

    start(): void {
        // Buttons idle physically high (internal pull-ups, enabled via
        // config.txt - see remote-setup.sh's configure_gpio_pullups) and are
        // pulled low on press, so a press is a falling edge. gpiomon's own
        // debounce (not software, unlike the previous onoff-based adapter)
        // covers contact bounce.
        this.buttonMonitor = this.spawnMonitor(
            [this.powerPin, this.modePin, this.actionPin, this.encoderBtnPin],
            ["--edges", "falling", "--debounce-period", String(this.buttonDebounceMs), "--format", "%o"],
            (line) => this.handleButtonEvent(line)
        );

        // No debounce on the encoder pins: contact bounce is instead
        // rejected by the quadrature FSM, which only counts full, legal A/B
        // transition sequences.
        this.encoderMonitor = this.spawnMonitor(
            [this.encoderAPin, this.encoderBPin],
            ["--edges", "both", "--format", "%o %e"],
            (line) => this.handleEncoderEvent(line)
        );

        logger.log("[GpioInput] GpioInputAdapter started.");
    }

    private spawnMonitor(pins: number[], extraArgs: string[], onLine: (line: string) => void): ChildProcessWithoutNullStreams {
        const label = `pins ${pins.join(",")}`;
        const proc = spawn("gpiomon", ["--chip", this.chip, ...extraArgs, ...pins.map(String)]);

        readline.createInterface({ input: proc.stdout }).on("line", onLine);

        proc.stderr.on("data", (data: Buffer) => {
            logger.error(`[GpioInput] gpiomon (${label}) error:`, data.toString().trim());
        });
        proc.on("error", (err) => {
            logger.error(`[GpioInput] failed to start gpiomon (${label}):`, err);
        });
        proc.on("exit", (code, signal) => {
            if (signal === "SIGTERM" || signal === "SIGKILL") return; // expected from stop()
            logger.error(`[GpioInput] gpiomon (${label}) exited unexpectedly: code=${code} signal=${signal}`);
        });

        return proc;
    }

    private handleButtonEvent(line: string): void {
        const offset = parseInt(line.trim(), 10);
        if (Number.isNaN(offset)) return;

        switch (offset) {
            case this.powerPin:
                this.powerCallback?.();
                break;
            case this.modePin:
                this.modeToggleCallback?.();
                break;
            case this.actionPin:
                this.actionCallback?.();
                break;
            case this.encoderBtnPin:
                this.volumeMuteCallback?.();
                break;
        }
    }

    private handleEncoderEvent(line: string): void {
        const parts = line.trim().split(/\s+/);
        const offset = parseInt(parts[0] ?? "", 10);
        const edgeStr = parts[1];
        if (Number.isNaN(offset) || edgeStr === undefined) return;

        const level: 0 | 1 = edgeStr === "1" ? 1 : 0; // 1 = rising, 2 = falling
        if (offset === this.encoderAPin) {
            this.encoderALevel = level;
        } else if (offset === this.encoderBPin) {
            this.encoderBLevel = level;
        } else {
            return;
        }

        const pinState = (this.encoderALevel << 1) | this.encoderBLevel;
        this.accumulator += QUADRATURE_STEP[this.lastPinState * 4 + pinState] ?? 0;
        this.lastPinState = pinState;

        if (this.accumulator >= STEPS_PER_DETENT) {
            this.accumulator -= STEPS_PER_DETENT;
            this.volumeCallback?.(this.volumeStepPerDetent);
        } else if (this.accumulator <= -STEPS_PER_DETENT) {
            this.accumulator += STEPS_PER_DETENT;
            this.volumeCallback?.(-this.volumeStepPerDetent);
        }
    }

    stop(): void {
        this.buttonMonitor?.kill();
        this.encoderMonitor?.kill();
    }
}
