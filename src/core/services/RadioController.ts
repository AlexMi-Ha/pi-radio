import { Mode, Power, State } from "../models/State";
import { ApiPort } from "../ports/ApiPort";
import { AudioPort } from "../ports/AudioPort";
import { InputPort } from "../ports/InputPort";
import { OutputPort } from "../ports/OutputPort";
import { PresetPort } from "../ports/PresetPort";

export class RadioController {
    
    private inputPort : InputPort;
    private outputPort : OutputPort; 
    private audioPort : AudioPort;
    private apiPort: ApiPort;
    private presetPort: PresetPort;

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
        console.log(this.state)
    }

    public init() {
        this.configureInputAdapter();
        this.configureApiAdapter();

        this.presetPort.onPresetsUpdated(() => {
            this.onSetMode(this.state.mode, true);
        })
    }

    private configureInputAdapter() {
        this.inputPort.onModeSelect((m) => this.onSetMode(m));
        this.inputPort.onPresetSelect((p) => this.onSetPreset(p));
        this.inputPort.onVolumeChange((delta: number) => {
            this.onSetVolume(this.state.volume + delta);
        });
        this.inputPort.onPowerToggle(() => {
            if(this.state.power == "power") {
                this.onSetPower("idle");
            }else {
                this.onSetPower("power");
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

    private onSetPower(power: Power) : void {
        this.state.power = power;
        if(this.state.power == "idle") {
            this.audioPort.stop();
            this.outputPort.idle();
        }else {
            this.onSetMode(this.state.mode, true);
            this.onSetVolume(this.state.volume);            
        }
    }
    private onSetMode(mode: Mode, force: boolean = false): void {
        if(mode == this.state.mode && !force) {
            return;
        }
        this.state.mode = mode;

        this.outputPort.setMode(this.state.mode);

        this.audioPort.stop();
        switch(this.state.mode) {
            case "internet_radio":
                this.outputPort.setPresetState(this.state.preset);
                const presetUrl = this.presetPort.getValueByPreset("internet_radio", this.state.preset);
                this.audioPort.playRadio(presetUrl);
                break;
            case "fm":
                this.outputPort.setPresetState(this.state.preset);
                const presetFreq = this.presetPort.getValueByPreset("fm" ,this.state.preset);
                this.audioPort.playFm(+presetFreq);
                break;
            case "bluetooth":
                this.outputPort.idlePresetState();
                this.audioPort.playBluetooth();
                break;
            case "spotify":
                this.outputPort.idlePresetState();
                this.audioPort.playSpotify();
                break;
        }
    }
    private onSetPreset(idx: number): void {
        if( !( this.state.mode == "internet_radio" || this.state.mode == "fm" )) {
            return;
        }
        if(this.state.preset == idx) {
            return;
        }
        this.state.preset = idx;
        this.outputPort.setPresetState(idx);
        this.audioPort.stop();
        
        if(this.state.mode == "internet_radio") {
            const presetUrl = this.presetPort.getValueByPreset("internet_radio", this.state.preset);
            this.audioPort.playRadio(presetUrl);
        }else {
            const presetFreq = this.presetPort.getValueByPreset("fm" ,this.state.preset);
            this.audioPort.playFm(+presetFreq);
        }
    }

    private onSetVolume(vol: number): void {
        const clampedVol = Math.min(Math.max(vol, 0), 100);
        this.state.volume = clampedVol;
        this.audioPort.setVolume(this.state.volume);
    }
}