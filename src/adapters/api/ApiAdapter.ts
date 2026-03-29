import express from "express";
import path from "path";
import { Power, Mode, State } from "../../core/models/State";
import { ApiPort } from "../../core/ports/ApiPort";
import { PresetPort } from "../../core/ports/PresetPort";

export class ApiAdapter implements ApiPort {

    private app;
    private port: number;
    private presetPort : PresetPort;
    
    private callbacks: {
        setPower?: (state: Power) => Promise<void>,
        setMode?: (mode: Mode) => Promise<void>,
        setVolume?: (vol: number) => Promise<void>,
        setPreset?: (idx: number) => Promise<void>
        getState? : () => State
    } = {};

    onSetPower(callback: (state: Power) => Promise<void>): void {
        this.callbacks.setPower = callback;
    }
    onSetMode(callback: (mode: Mode) => Promise<void>): void {
        this.callbacks.setMode = callback;
    }
    onSetVolume(callback: (vol: number) => Promise<void>): void {
        this.callbacks.setVolume = callback;
    }
    onSetPreset(callback: (idx: number) => Promise<void>): void {
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
        this.setupApiRoutes();
        this.setupWebRoutes();
    }

    private setupWebRoutes() {
        const projectRoot = path.resolve(__dirname, "../..");

        this.app.use('/public', express.static(path.join(projectRoot, 'web', 'public')))

        this.app.get('/', (req,res) => {
            res.sendFile(path.join(projectRoot, 'web', 'index.html'))
        });
    }

    private setupApiRoutes() {
        this.app.get('/api/state', (req, res) => {
            if(!this.callbacks.getState) {
                res.statusCode = 501;
                res.send('getState callback not implemented');
                return;
            }
            const state = this.callbacks.getState?.();
            res.json(state);
        });

        this.app.post('/api/power', async (req, res) => {
            if(!this.callbacks.setPower) {
                res.statusCode = 501;
                res.send('setPower callback not implemented');
                return;
            }
            const {power} = req.body;
            await this.callbacks.setPower(power);

            res.json(this.callbacks.getState?.());
        });

        this.app.post('/api/mode', async (req, res) => {
            if(!this.callbacks.setMode) {
                res.statusCode = 501;
                res.send('setMode callback not implemented');
                return;
            }
            const {mode} = req.body;
            await this.callbacks.setMode(mode);

            res.json(this.callbacks.getState?.());
        });

        this.app.post('/api/volume', async (req,res) => {
            if(!this.callbacks.setVolume) {
                res.statusCode = 501;
                res.send('setVolume callback not implemented');
                return;
            }
            const {volume} = req.body;
            await this.callbacks.setVolume(volume);

            res.json(this.callbacks.getState?.());
        });

        this.app.post('/api/preset', async (req,res) => {
            if(!this.callbacks.setPreset) {
                res.statusCode = 501;
                res.send('setPreset callback not implemented');
                return;
            }
            const {preset} = req.body;
            await this.callbacks.setPreset(preset);

            res.json(this.callbacks.getState?.());
        });

        this.app.get('/api/preset', (req, res) => {
            const presets = this.presetPort.getAllPresets();
            res.json(presets);
        });
        this.app.get('/api/preset/:mode', (req, res) => {
            const mode = req.params.mode;
            if(!(mode == "internet_radio" || mode == "fm")) {
                res.statusCode = 400;
                res.send("Unknown radio mode for presets");
                return;
            }
            res.json(this.getPresetsOfMode(mode));
        });

        this.app.get('/api/preset/:mode/:presetId', (req, res) => {
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

        this.app.post('/api/preset/:mode/:presetId', (req, res) => {
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