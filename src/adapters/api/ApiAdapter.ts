import express, {Request, Response} from "express";
import { Power, Mode, State } from "../../core/models/State";
import { ApiPort } from "../../core/ports/ApiPort";
import { PresetPort } from "../../core/ports/PresetPort";

export class ApiAdapter implements ApiPort {

    private app;
    private port: number;
    private presetPort : PresetPort;
    
    private callbacks: {
        setPower?: (state: Power) => void,
        setMode?: (mode: Mode) => void,
        setVolume?: (vol: number) => void,
        setPreset?: (idx: number) => void
        getState? : () => State
    } = {};

    onSetPower(callback: (state: Power) => void): void {
        this.callbacks.setPower = callback;
    }
    onSetMode(callback: (mode: Mode) => void): void {
        this.callbacks.setMode = callback;
    }
    onSetVolume(callback: (vol: number) => void): void {
        this.callbacks.setVolume = callback;
    }
    onSetPreset(callback: (idx: number) => void): void {
        this.callbacks.setPreset = callback;
    }
    onGetState(callback: () => State): void {
        this.callbacks.getState = callback;
    }

    constructor(presetPort : PresetPort, port: number) {
        this.presetPort = presetPort;
        this.port = port;
        this.app = express();
        this.app.use(express.json());
        this.setupRoutes();
    }

    private setupRoutes() {
        this.app.get('/', (req, res) => {
            if(!this.callbacks.getState) {
                res.statusCode = 501;
                res.send('getState callback not implemented');
                return;
            }
            const state = this.callbacks.getState?.();
            res.json(state);
        });

        this.app.post('/power', (req, res) => {
            if(!this.callbacks.setPower) {
                res.statusCode = 501;
                res.send('setPower callback not implemented');
                return;
            }
            const {state} = req.body;
            this.callbacks.setPower(state);

            res.json(this.callbacks.getState?.());
        });

        this.app.post('/mode', (req, res) => {
            if(!this.callbacks.setMode) {
                res.statusCode = 501;
                res.send('setMode callback not implemented');
                return;
            }
            const {mode} = req.body;
            this.callbacks.setMode(mode);

            res.json(this.callbacks.getState?.());
        });

        this.app.post('/volume', (req,res) => {
            if(!this.callbacks.setVolume) {
                res.statusCode = 501;
                res.send('setVolume callback not implemented');
                return;
            }
            const {vol} = req.body;
            this.callbacks.setVolume(vol);

            res.json(this.callbacks.getState?.());
        });

        this.app.post('/preset', (req,res) => {
            if(!this.callbacks.setPreset) {
                res.statusCode = 501;
                res.send('setPreset callback not implemented');
                return;
            }
            const {preset} = req.body;
            this.callbacks.setPreset(preset);

            res.json(this.callbacks.getState?.());
        });

        this.app.get('/preset', (req, res) => {
            const presets = this.presetPort.getAllPresets();
            res.json(presets);
        });
        this.app.get('/preset/:mode', (req, res) => {
            const mode = req.params.mode;
            if(!(mode == "internet_radio" || mode == "fm")) {
                res.statusCode = 400;
                res.send("Unknown radio mode for presets");
                return;
            }
            res.json(this.getPresetsOfMode(mode));
        });

        this.app.get('/preset/:mode/:presetId', (req, res) => {
            const mode = req.params.mode;
            const presetId = Number.parseInt(req.params.presetId, 10);
            if(!(mode == "internet_radio" || mode == "fm")) {
                res.statusCode = 400;
                res.send("Unknown radio mode for presets");
                return;
            }
            const presets = this.getPresetsOfMode(mode);
            if(Number.isNaN(presetId) || presetId < 0 || presetId > this.presetPort.getMaxPresetIndex() || presetId > presets.length - 1) {
                res.statusCode = 400;
                res.send("Invalid presetId");
                return;
            }
            
            res.json(presets[presetId]);
        });

        this.app.post('/preset/:mode/:presetId', (req, res) => {
            const mode = req.params.mode;
            const presetId = Number.parseInt(req.params.presetId, 10);
            const {value} = req.body;
            if(!(mode == "internet_radio" || mode == "fm")) {
                res.statusCode = 400;
                res.send("Unknown radio mode for presets");
                return;
            }
            const presets = this.getPresetsOfMode(mode);
            if(Number.isNaN(presetId) || presetId < 0 || presetId > this.presetPort.getMaxPresetIndex() || presetId > presets.length - 1) {
                res.statusCode = 400;
                res.send("Invalid presetId");
                return;
            }
            
            this.presetPort.setValueForPreset(mode, presetId, value);
        });
    }

    public start() {
        this.app.listen(this.port, () => {
            console.log(`API server running on http://localhost:${this.port}`)
        });
    }

    private getPresetsOfMode(mode: Mode): string[] {
        const presets = this.presetPort.getAllPresets();
        if(mode == "internet_radio") {
            return presets.internet_radio;
        }else {
            return presets.fm;
        }
    }
}