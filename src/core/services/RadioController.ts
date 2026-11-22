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

const MODES: Mode[] = ["internet_radio", "bluetooth"];

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
            this.modeAsyncProcessor.runSafe(() => this.onSetMode(this.state.mode, true));
        });

        this.audioPort.onNowPlayingChanged((info) => {
            this.state.nowPlaying = info;
            this.refreshDisplay();
        });

        this.audioPort.onConnectionChanged((connected) => {
            this.state.connected = connected;
            if(connected) {
                this.state.pairing = false;
                this.outputPort.setPairingState(false);
            }
            this.refreshDisplay();
        });
    }

    private configureInputAdapter() {
        this.inputPort.onModeToggle(() => {
            this.modeAsyncProcessor.runSafe(() => this.onSetMode(this.nextMode()));
        });
        this.inputPort.onActionPress(() => {
            if(this.state.mode == "internet_radio") {
                this.presetAsyncProcessor.runSafe(() => this.onSetPreset(this.nextPreset()));
            }else if(this.state.mode == "bluetooth") {
                this.pairingAsyncProcessor.runSafe(() => this.onEnablePairing());
            }
        });
        this.inputPort.onVolumeChange((delta: number) => {
            this.volumeAsyncProcessor.runSafe(() => this.onSetVolume(this.state.volume + delta));
        });
        this.inputPort.onVolumeMute(() => {
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
        this.state.power = power;
        if(this.state.power == "idle") {
            this.settingsPort.save({
                mode: this.state.mode,
                volume: this.state.volume,
                preset: this.state.preset
            });
            await this.audioPort.stop();
            this.outputPort.idle();
        }else {
            await this.onSetMode(this.state.mode, true);
            await this.onSetVolume(this.state.volume);
        }
    }

    private async onSetMode(mode: Mode, force: boolean = false): Promise<void> {
        if(mode == this.state.mode && !force) {
            return;
        }
        this.state.mode = mode;
        this.state.pairing = false;
        this.state.connected = false;
        this.state.nowPlaying = {};

        if(!isPresetMode(this.state.mode) || this.presetPort.getNumPresets(this.state.mode) <= this.state.preset) {
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
        this.state.preset = idx;
        this.state.nowPlaying = {};
        this.outputPort.setPresetState(idx);
        this.refreshDisplay();

        await this.audioPort.playMode(this.state.mode, this.state.preset);
    }

    private async onSetVolume(vol: number): Promise<void> {
        this.state.volume = clamp(0, 100, vol);
        if(this.state.muted) {
            this.state.muted = false;
            this.refreshDisplay();
        }
        await this.audioPort.setVolume(this.state.volume);
    }

    private async onSetMute(muted: boolean): Promise<void> {
        if(this.state.muted == muted) {
            return;
        }
        this.state.muted = muted;
        this.refreshDisplay();
        await this.audioPort.setVolume(this.state.muted ? 0 : this.state.volume);
    }

    private async onEnablePairing(): Promise<void> {
        if(this.state.mode != "bluetooth") {
            return;
        }
        this.state.pairing = true;
        this.outputPort.setPairingState(true);
        this.refreshDisplay();
        await this.audioPort.enablePairing();
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
            return [station, this.state.nowPlaying.title, undefined];
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
