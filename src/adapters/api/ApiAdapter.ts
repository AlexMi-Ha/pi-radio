import express from "express";
import http from "http";
import path from "path";
import { Power, PresetMode ,Mode, State, isPresetMode, _presetModes } from "../../core/models/State";
import { ApiPort } from "../../core/ports/ApiPort";
import { PresetPort } from "../../core/ports/PresetPort";

export class ApiAdapter implements ApiPort {

    private app;
    private server?: http.Server;
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
            const presets: Record<string, string[]> = {};
            for(const presetMode of _presetModes) {
                presets[presetMode] = this.presetPort.getAllPresets(presetMode);
            }
            res.json(presets);
        });
        this.app.get('/api/preset/:mode', (req, res) => {
            const mode = req.params.mode;
            if(!isPresetMode(mode)) {
                res.statusCode = 400;
                res.send("Unknown radio mode for presets");
                return;
            }
            res.json(this.getPresetsOfMode(mode));
        });

        this.app.get('/api/preset/:mode/:presetId', (req, res) => {
            const mode = req.params.mode;
            if(!isPresetMode(mode)) {
                res.statusCode = 400;
                res.send("Unknown radio mode for presets");
                return;
            }
            const presets = this.getPresetsOfMode(mode);
            const presetId = this.parsePresetId(req.params.presetId, presets.length);
            if(presetId === undefined) {
                res.statusCode = 400;
                res.send("Invalid presetId");
                return;
            }

            res.json(presets[presetId]);
        });

        this.app.post('/api/preset/:mode/:presetId', (req, res) => {
            const mode = req.params.mode;
            const {value} = req.body;
            if(!isPresetMode(mode)) {
                res.statusCode = 400;
                res.send("Unknown radio mode for presets");
                return;
            }
            const presets = this.getPresetsOfMode(mode);
            const presetId = this.parsePresetId(req.params.presetId, presets.length);
            if(presetId === undefined) {
                res.statusCode = 400;
                res.send("Invalid presetId");
                return;
            }

            this.presetPort.setValueForPreset(mode, presetId, value);
            res.json(this.getPresetsOfMode(mode));
        });
    }

    public start() {
        this.server = this.app.listen(this.port, () => {
            console.log(`[Api] API server running on http://localhost:${this.port}`)
        });
    }

    public stop(): void {
        this.server?.close();
    }

    private getPresetsOfMode(mode: PresetMode): string[] {
        return this.presetPort.getAllPresets(mode);
    }

    private parsePresetId(raw: string, numPresets: number): number | undefined {
        const presetId = Number.parseInt(raw, 10);
        if(Number.isNaN(presetId) || presetId < 0 || presetId >= numPresets) {
            return undefined;
        }
        return presetId;
    }
}
