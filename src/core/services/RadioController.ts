import { isPresetMode, Mode, Power, State } from "../models/State";
import { ApiPort } from "../ports/ApiPort";
import { AudioPort } from "../ports/AudioPort";
import { DisplayPort } from "../ports/DisplayPort";
import { InputPort } from "../ports/InputPort";
import { OutputPort } from "../ports/OutputPort";
import { PresetPort } from "../ports/PresetPort";
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

    private powerAsyncProcessor: AsyncProcessor;
    private modeAsyncProcessor: AsyncProcessor;
    private volumeAsyncProcessor: AsyncProcessor;
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
        state: State
    }) {
        this.inputPort = params.inputPort;
        this.outputPort = params.outputPort;
        this.displayPort = params.displayPort;
        this.audioPort = params.audioPort;
        this.apiPort = params.apiPort;
        this.presetPort = params.presetPort;
        this.state = params.state;

        this.powerAsyncProcessor = new AsyncProcessor();
        this.modeAsyncProcessor = new AsyncProcessor();
        this.volumeAsyncProcessor = new AsyncProcessor();
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
    }

    private async onSetPower(power: Power) : Promise<void> {
        this.state.power = power;
        if(this.state.power == "idle") {
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
        await this.audioPort.setVolume(this.state.volume);
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
        if(this.state.mode == "internet_radio") {
            const station = this.presetPort.getValueByPreset("internet_radio", this.state.preset) || "No station set";
            this.displayPort.showLines(station, this.state.nowPlaying.title);
        }else {
            // No real BlueZ connection-state tracking yet (BluetoothAudioProvider is a
            // stub), so "paired" is approximated by having live track metadata.
            if(this.state.pairing) {
                this.displayPort.showLines("Pairing", this.state.nowPlaying.title, { blink: true });
            }else if(this.state.nowPlaying.title) {
                this.displayPort.showLines("Paired", this.state.nowPlaying.title);
            }else {
                this.displayPort.showLines("Bluetooth", "Not Paired");
            }
        }
    }
}
