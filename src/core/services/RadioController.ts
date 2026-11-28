import { isPresetMode, Mode, Power, State } from "../models/State";
import { ApiPort } from "../ports/ApiPort";
import { AudioPort } from "../ports/AudioPort";
import { DisplayPort } from "../ports/DisplayPort";
import { InputPort } from "../ports/InputPort";
import { OutputPort } from "../ports/OutputPort";
import { PresetPort } from "../ports/PresetPort";
import { SettingsPort } from "../ports/SettingsPort";
import { AsyncProcessor } from "../util/AsyncProcessor";
import { clamp, wrap } from "../util/util";
import { logger } from "../util/Logger";

const MODES: Mode[] = ["internet_radio", "bluetooth"];

// HD44780-compatible character ROMs (shared by both the PCF8574 and
// AiP31068L LCD adapters) map 0xFF to a solid filled square - using it here
// (rather than e.g. "█", which isn't representable as a single byte) keeps
// RadioController's bar string paintable as-is by both adapters' writeChars.
const VOLUME_BAR_WIDTH = 16;
const VOLUME_BAR_FILLED_CHAR = "\xFF";
const VOLUME_DISPLAY_DURATION_MS = 5000;
// Capped at 96 (not 100) so it divides evenly into the 16-square display bar
// (96 / 16 = 6) - every volume unit maps to exactly 1/6 of a square, instead
// of rounding unevenly against 100.
const VOLUME_MAX = 96;

// Indeterminate "loading" indicator shown on line 2 while a station connects:
// a short filled segment slides across the line, repeating until playback
// starts (or the mode/preset/power changes away from it).
const LOADING_BAR_WIDTH = 16;
const LOADING_BAR_SEGMENT_WIDTH = 4;
const LOADING_BAR_ANIMATION_INTERVAL_MS = 150;

// Bonding/A2DP-connection isn't guaranteed to ever complete (e.g. a phone
// backs out mid-pairing, or BlueZ never reports Device1.Connected) - without
// a fallback the "Pairing" display would otherwise blink forever.
const PAIRING_TIMEOUT_MS = 2 * 60 * 1000;

export class RadioController {

    private inputPort : InputPort;
    private outputPort : OutputPort;
    private displayPort : DisplayPort;
    private audioPort : AudioPort;
    private apiPort: ApiPort;
    private presetPort: PresetPort;
    private settingsPort: SettingsPort;

    private powerAsyncProcessor: AsyncProcessor;
    private modeAsyncProcessor: AsyncProcessor;
    private volumeAsyncProcessor: AsyncProcessor;
    private muteAsyncProcessor: AsyncProcessor;
    private presetAsyncProcessor: AsyncProcessor;
    private pairingAsyncProcessor: AsyncProcessor;
    private pairingTimeoutHandle: ReturnType<typeof setTimeout> | undefined;
    private loadingAnimationHandle: ReturnType<typeof setInterval> | undefined;
    private loadingAnimationPos = 0;

    private state: State;

    constructor(params: {
        inputPort: InputPort,
        outputPort: OutputPort,
        displayPort: DisplayPort,
        audioPort: AudioPort,
        apiPort: ApiPort,
        presetPort: PresetPort,
        settingsPort: SettingsPort,
        state: State
    }) {
        this.inputPort = params.inputPort;
        this.outputPort = params.outputPort;
        this.displayPort = params.displayPort;
        this.audioPort = params.audioPort;
        this.apiPort = params.apiPort;
        this.presetPort = params.presetPort;
        this.settingsPort = params.settingsPort;
        this.state = params.state;

        this.powerAsyncProcessor = new AsyncProcessor();
        this.modeAsyncProcessor = new AsyncProcessor();
        this.volumeAsyncProcessor = new AsyncProcessor();
        this.muteAsyncProcessor = new AsyncProcessor();
        this.presetAsyncProcessor = new AsyncProcessor();
        this.pairingAsyncProcessor = new AsyncProcessor();
    }

    public init() {
        this.configureInputAdapter();
        this.configureApiAdapter();

        this.presetPort.onPresetsUpdated(() => {
            logger.log("[RadioController] Presets updated, reapplying current mode");
            this.modeAsyncProcessor.runSafe(() => this.onSetMode(this.state.mode, true));
        });

        this.audioPort.onNowPlayingChanged((info) => {
            this.state.nowPlaying = info;
            if(info.loading) {
                this.startLoadingAnimation();
            }else {
                this.stopLoadingAnimation();
            }
            this.refreshDisplay();
        });

        this.audioPort.onConnectionChanged((connected) => {
            logger.log(`[RadioController] Bluetooth connection changed: connected=${connected}`);
            this.state.connected = connected;
            if(connected) {
                this.clearPairingTimeout();
                this.state.pairing = false;
                this.outputPort.setPairingState(false);
            }
            this.refreshDisplay();
        });

        // Apply the side effects (display/audio/output) matching the initial
        // state, since it was set directly on the State object rather than
        // through onSetPower().
        this.powerAsyncProcessor.runSafe(() => this.onSetPower(this.state.power));
    }

    private configureInputAdapter() {
        this.inputPort.onModeToggle(() => {
            if(this.state.power != "power") return;
            this.modeAsyncProcessor.runSafe(() => this.onSetMode(this.nextMode()));
        });
        this.inputPort.onActionPress(() => {
            if(this.state.power != "power") return;
            if(this.state.mode == "internet_radio") {
                this.presetAsyncProcessor.runSafe(() => this.onSetPreset(this.nextPreset()));
            }else if(this.state.mode == "bluetooth") {
                this.pairingAsyncProcessor.runSafe(() => this.onEnablePairing());
            }
        });
        this.inputPort.onVolumeChange((delta: number) => {
            if(this.state.power != "power") return;
            this.volumeAsyncProcessor.runSafe(() => this.onSetVolume(this.state.volume + delta));
        });
        this.inputPort.onVolumeMute(() => {
            if(this.state.power != "power") return;
            this.muteAsyncProcessor.runSafe(() => this.onSetMute(!this.state.muted));
        });
        this.inputPort.onPowerToggle(() => {
            if(this.state.power == "power") {
                this.powerAsyncProcessor.runSafe(() => this.onSetPower("idle"));
            }else {
                this.powerAsyncProcessor.runSafe(() => this.onSetPower("power"));
            }
        });
    }

    private configureApiAdapter() {
        this.apiPort.onSetPower(async (p) => this.powerAsyncProcessor.runSafe(() => this.onSetPower(p)));
        this.apiPort.onGetState(() => this.state);
        this.apiPort.onSetMode(async (m) => this.modeAsyncProcessor.runSafe(() => this.onSetMode(m)));
        this.apiPort.onSetPreset(async (p) => this.presetAsyncProcessor.runSafe(() => this.onSetPreset(p)));
        this.apiPort.onSetVolume(async (v) => this.volumeAsyncProcessor.runSafe(() => this.onSetVolume(v)));
        this.apiPort.onSetMute(async (m) => this.muteAsyncProcessor.runSafe(() => this.onSetMute(m)));
    }

    private async onSetPower(power: Power) : Promise<void> {
        logger.log(`[RadioController] Setting power: ${this.state.power} -> ${power}`);
        this.state.power = power;
        if(this.state.power == "idle") {
            this.settingsPort.save({
                mode: this.state.mode,
                volume: this.state.volume,
                preset: this.state.preset
            });
            await this.audioPort.stop();
            this.stopLoadingAnimation();
            this.outputPort.idle();
            this.displayPort.setPower(false);
        }else {
            this.displayPort.setPower(true);
            await this.onSetMode(this.state.mode, true);
            await this.onSetVolume(this.state.volume);
        }
    }

    private async onSetMode(mode: Mode, force: boolean = false): Promise<void> {
        if(mode == this.state.mode && !force) {
            return;
        }
        logger.log(`[RadioController] Setting mode: ${this.state.mode} -> ${mode}${force ? " (forced)" : ""}`);
        this.clearPairingTimeout();
        this.state.mode = mode;
        this.state.pairing = false;
        this.state.connected = false;
        this.state.nowPlaying = {};
        this.stopLoadingAnimation();

        if(isPresetMode(this.state.mode) && this.presetPort.getNumPresets(this.state.mode) <= this.state.preset) {
            this.state.preset = 0;
        }

        this.outputPort.setMode(this.state.mode);
        this.outputPort.setPairingState(false);

        if(isPresetMode(this.state.mode)) {
            this.outputPort.setPresetState(this.state.preset);
        }else {
            this.outputPort.idlePresetState();
        }

        this.displayPort.showTransient(this.modeLabel(this.state.mode));
        this.refreshDisplay();

        await this.audioPort.playMode(this.state.mode, this.state.preset);
    }

    private async onSetPreset(idx: number): Promise<void> {
        if( !isPresetMode(this.state.mode)) {
            return;
        }
        if(this.state.preset == idx) {
            return;
        }
        logger.log(`[RadioController] Setting preset: ${this.state.preset} -> ${idx}`);
        this.state.preset = idx;
        this.state.nowPlaying = {};
        this.stopLoadingAnimation();
        this.outputPort.setPresetState(idx);
        this.refreshDisplay();

        await this.audioPort.playMode(this.state.mode, this.state.preset);
    }

    private async onSetVolume(vol: number): Promise<void> {
        const newVolume = clamp(0, VOLUME_MAX, vol);
        const changed = newVolume != this.state.volume;
        logger.log(`[RadioController] Setting volume: ${this.state.volume} -> ${newVolume}`);
        this.state.volume = newVolume;

        let unmuted = false;
        if(this.state.muted) {
            this.state.muted = false;
            unmuted = true;
            // Restore the persistent (non-muted) content first, so that once
            // the transient volume bar below expires, the display reverts to
            // it rather than to the stale "MUTED" screen.
            this.refreshDisplay();
        }
        if(changed || unmuted) {
            this.displayPort.showTransient("Volume", this.volumeBar(this.state.volume), VOLUME_DISPLAY_DURATION_MS);
        }
        await this.audioPort.setVolume(this.state.volume);
    }

    private volumeBar(volume: number): string {
        const filled = Math.round(clamp(0, VOLUME_MAX, volume) / VOLUME_MAX * VOLUME_BAR_WIDTH);
        return VOLUME_BAR_FILLED_CHAR.repeat(filled) + " ".repeat(VOLUME_BAR_WIDTH - filled);
    }

    private startLoadingAnimation() {
        if(this.loadingAnimationHandle) {
            return;
        }
        this.loadingAnimationPos = 0;
        this.loadingAnimationHandle = setInterval(() => {
            this.loadingAnimationPos = (this.loadingAnimationPos + 1) % (LOADING_BAR_WIDTH - LOADING_BAR_SEGMENT_WIDTH + 1);
            this.refreshDisplay();
        }, LOADING_BAR_ANIMATION_INTERVAL_MS);
    }

    private stopLoadingAnimation() {
        if(this.loadingAnimationHandle) {
            clearInterval(this.loadingAnimationHandle);
            this.loadingAnimationHandle = undefined;
        }
    }

    private loadingBar(): string {
        const before = " ".repeat(this.loadingAnimationPos);
        const after = " ".repeat(LOADING_BAR_WIDTH - LOADING_BAR_SEGMENT_WIDTH - this.loadingAnimationPos);
        return before + VOLUME_BAR_FILLED_CHAR.repeat(LOADING_BAR_SEGMENT_WIDTH) + after;
    }

    private async onSetMute(muted: boolean): Promise<void> {
        if(this.state.muted == muted) {
            return;
        }
        logger.log(`[RadioController] Setting mute: ${muted}`);
        this.state.muted = muted;
        this.refreshDisplay();
        await this.audioPort.setVolume(this.state.muted ? 0 : this.state.volume);
    }

    private async onEnablePairing(): Promise<void> {
        if(this.state.mode != "bluetooth") {
            return;
        }
        logger.log("[RadioController] Enabling Bluetooth pairing");
        this.clearPairingTimeout();
        this.state.pairing = true;
        this.outputPort.setPairingState(true);
        this.refreshDisplay();
        this.pairingTimeoutHandle = setTimeout(() => {
            if(!this.state.pairing) {
                return;
            }
            logger.log("[RadioController] Pairing timed out, reverting to Not Paired");
            this.state.pairing = false;
            this.outputPort.setPairingState(false);
            this.refreshDisplay();
        }, PAIRING_TIMEOUT_MS);
        // Doesn't represent real app work pending - never keep the process (or a
        // test's Jest worker) alive just to wait this out.
        this.pairingTimeoutHandle.unref?.();
        await this.audioPort.enablePairing();
    }

    private clearPairingTimeout(): void {
        if(this.pairingTimeoutHandle) {
            clearTimeout(this.pairingTimeoutHandle);
            this.pairingTimeoutHandle = undefined;
        }
    }

    private nextMode(): Mode {
        const idx = MODES.indexOf(this.state.mode);
        return MODES[(idx + 1) % MODES.length]!;
    }

    private nextPreset(): number {
        const numPresets = this.presetPort.getNumPresets("internet_radio");
        if(numPresets <= 0) {
            return this.state.preset;
        }
        return wrap(0, numPresets - 1, this.state.preset, 1);
    }

    private modeLabel(mode: Mode): string {
        return mode == "internet_radio" ? "Internet Radio" : "Bluetooth";
    }

    private refreshDisplay() {
        const [line1, line2, options] = this.displayLines();
        if(this.state.muted) {
            this.displayPort.showLines(line1, "MUTED", { blink: true });
        }else if(options) {
            this.displayPort.showLines(line1, line2, options);
        }else {
            this.displayPort.showLines(line1, line2);
        }
    }

    private displayLines(): [string, string | undefined, { blink?: boolean } | undefined] {
        if(this.state.mode == "internet_radio") {
            const name = this.presetPort.getNameByPreset("internet_radio", this.state.preset);
            const value = this.presetPort.getValueByPreset("internet_radio", this.state.preset);
            const station = name || value || "No station set";
            const line2 = this.state.nowPlaying.loading ? this.loadingBar() : this.state.nowPlaying.title;
            return [station, line2, undefined];
        }else {
            if(this.state.pairing) {
                return ["Pairing", this.state.nowPlaying.title, { blink: true }];
            }else if(this.state.connected) {
                return ["Paired", this.state.nowPlaying.title, undefined];
            }else {
                return ["Bluetooth", "Not Paired", undefined];
            }
        }
    }
}
