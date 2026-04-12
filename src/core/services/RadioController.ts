import { FM_FREQ_MAX, FM_FREQ_MIN, isPresetMode, Mode, Power, State } from "../models/State";
import { ApiPort } from "../ports/ApiPort";
import { AudioPort } from "../ports/AudioPort";
import { InputPort } from "../ports/InputPort";
import { OutputPort } from "../ports/OutputPort";
import { PresetPort } from "../ports/PresetPort";
import { AsyncProcessor } from "../util/AsyncProcessor";
import { clamp, wrap } from "../util/util";

export class RadioController {
    
    private inputPort : InputPort;
    private outputPort : OutputPort; 
    private audioPort : AudioPort;
    private apiPort: ApiPort;
    private presetPort: PresetPort;

    private powerAsyncProcessor: AsyncProcessor;
    private modeAsyncProcessor: AsyncProcessor;
    private volumeAsyncProcessor: AsyncProcessor;
    private fmFreqAsyncProcessor: AsyncProcessor;
    private presetAsyncProcessor: AsyncProcessor;

    private state: State;

    constructor(params: {
        inputPort: InputPort,
        outputPort: OutputPort,
        audioPort: AudioPort,
        apiPort: ApiPort,
        presetPort: PresetPort,
        state: State
    }) {
        this.inputPort = params.inputPort;
        this.outputPort = params.outputPort;
        this.audioPort = params.audioPort;
        this.apiPort = params.apiPort;
        this.presetPort = params.presetPort;
        this.state = params.state;

        this.powerAsyncProcessor = new AsyncProcessor();
        this.modeAsyncProcessor = new AsyncProcessor();
        this.volumeAsyncProcessor = new AsyncProcessor();
        this.fmFreqAsyncProcessor = new AsyncProcessor();
        this.presetAsyncProcessor = new AsyncProcessor();
    }

    public init() {
        this.configureInputAdapter();
        this.configureApiAdapter();

        this.presetPort.onPresetsUpdated(() => {
            this.modeAsyncProcessor.runSafe(() => this.onSetMode(this.state.mode, true));
        })
    }

    private configureInputAdapter() {
        this.inputPort.onModeSelect((m) => this.modeAsyncProcessor.runSafe(() => this.onSetMode(m)));
        this.inputPort.onPresetSelect((p) => this.presetAsyncProcessor.runSafe(() => this.onSetPreset(p)));
        this.inputPort.onVolumeChange((delta: number) => {
            this.volumeAsyncProcessor.runSafe(() => this.onSetVolume(this.state.volume + delta));
        });
        this.inputPort.onFMFrequencyChange((delta: number) => {
            this.fmFreqAsyncProcessor.runSafe(() => this.onSetFmFreq(delta))
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
        this.apiPort.onSetPower((p) => this.onSetPower(p));
        this.apiPort.onGetState(() => this.state);
        this.apiPort.onSetMode((m) => this.onSetMode(m));
        this.apiPort.onSetPreset((p) => this.onSetPreset(p));
        this.apiPort.onSetVolume((v) => this.onSetVolume(v));
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

        if(!isPresetMode(this.state.mode) || this.presetPort.getNumPresets(this.state.mode) <= this.state.preset) {
            this.state.preset = 1;
        }

        this.outputPort.setMode(this.state.mode);

        if(isPresetMode(this.state.mode)) {
            this.outputPort.setPresetState(this.state.preset);
        }else {
            this.outputPort.idlePresetState();
        }

        if(this.state.mode == "fm") {
            this.updateFreqStateToPreset();
        }

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
        this.outputPort.setPresetState(idx);

        if(this.state.mode == "fm") {
            this.updateFreqStateToPreset();
        }
        
        await this.audioPort.playMode(this.state.mode, this.state.preset);
    }

    private async onSetVolume(vol: number): Promise<void> {
        this.state.volume = clamp(0, 100, vol);
        await this.audioPort.setVolume(this.state.volume);
    }

    private async onSetFmFreq(delta: number): Promise<void> {
        if(this.state.mode != "fm") {
            return;
        }
        this.state.freq = wrap(FM_FREQ_MIN, FM_FREQ_MAX, this.state.freq, delta);
        this.outputPort.idlePresetState();
        await this.audioPort.playFMFreq(this.state.freq);
    }

    private updateFreqStateToPreset() {
        const presetFreq = parseInt(this.presetPort.getValueByPreset('fm', this.state.preset), 10);
        this.state.freq = Number.isNaN(presetFreq) ? 88 : presetFreq;
    }
}