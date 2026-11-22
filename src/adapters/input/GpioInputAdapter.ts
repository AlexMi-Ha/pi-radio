import { Gpio } from "onoff";
import { InputPort } from "../../core/ports/InputPort";

export interface GpioInputAdapterOptions {
    powerButtonPin: number;
    modeButtonPin: number;
    actionButtonPin: number;
    encoderAPin: number;
    encoderBPin: number;
    encoderButtonPin: number;
    buttonDebounceMs?: number;
    volumeStepPerDetent?: number;
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

export class GpioInputAdapter implements InputPort {
    private volumeCallback?: (delta: number) => void;
    private volumeMuteCallback?: () => void;
    private modeToggleCallback?: () => void;
    private actionCallback?: () => void;
    private powerCallback?: () => void;

    private readonly volumeStepPerDetent: number;

    private powerBtn: Gpio;
    private modeBtn: Gpio;
    private actionBtn: Gpio;
    private encoderA: Gpio;
    private encoderB: Gpio;
    private encoderBtn: Gpio;

    // Quadrature decoder state (see QUADRATURE_STEP above).
    private lastPinState = 0;
    private accumulator = 0;

    constructor(options: GpioInputAdapterOptions) {
        const debounceTimeout = options.buttonDebounceMs ?? 25;
        this.volumeStepPerDetent = options.volumeStepPerDetent ?? 1;

        this.powerBtn = new Gpio(options.powerButtonPin, "in", "falling", {
            debounceTimeout,
            activeLow: true,
        });
        this.modeBtn = new Gpio(options.modeButtonPin, "in", "falling", {
            debounceTimeout,
            activeLow: true,
        });
        this.actionBtn = new Gpio(options.actionButtonPin, "in", "falling", {
            debounceTimeout,
            activeLow: true,
        });
        this.encoderBtn = new Gpio(options.encoderButtonPin, "in", "falling", {
            debounceTimeout,
            activeLow: true,
        });

        // No debounce on the encoder pins: contact bounce is instead
        // rejected by the quadrature FSM, which only counts full,
        // legal A/B transition sequences.
        this.encoderA = new Gpio(options.encoderAPin, "in", "both");
        this.encoderB = new Gpio(options.encoderBPin, "in", "both");
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
        this.powerBtn.watch((err) => {
            if (err) {
                console.error("[GpioInput] power button watch error:", err);
                return;
            }
            this.powerCallback?.();
        });

        this.modeBtn.watch((err) => {
            if (err) {
                console.error("[GpioInput] mode button watch error:", err);
                return;
            }
            this.modeToggleCallback?.();
        });

        this.actionBtn.watch((err) => {
            if (err) {
                console.error("[GpioInput] action button watch error:", err);
                return;
            }
            this.actionCallback?.();
        });

        this.encoderBtn.watch((err) => {
            if (err) {
                console.error("[GpioInput] encoder button watch error:", err);
                return;
            }
            this.volumeMuteCallback?.();
        });

        const onEncoderEdge = (err: Error | null | undefined) => {
            if (err) {
                console.error("[GpioInput] encoder watch error:", err);
                return;
            }
            this.handleEncoderEdge();
        };
        this.encoderA.watch(onEncoderEdge);
        this.encoderB.watch(onEncoderEdge);

        console.log("[GpioInput] GpioInputAdapter started.");
    }

    private handleEncoderEdge(): void {
        const a = this.encoderA.readSync();
        const b = this.encoderB.readSync();
        const pinState = (a << 1) | b;

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
        this.powerBtn.unwatchAll();
        this.modeBtn.unwatchAll();
        this.actionBtn.unwatchAll();
        this.encoderA.unwatchAll();
        this.encoderB.unwatchAll();
        this.encoderBtn.unwatchAll();

        this.powerBtn.unexport();
        this.modeBtn.unexport();
        this.actionBtn.unexport();
        this.encoderA.unexport();
        this.encoderB.unexport();
        this.encoderBtn.unexport();
    }
}
