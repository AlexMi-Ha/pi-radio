import { ChildProcessWithoutNullStreams, spawn } from "child_process";
import { Mode } from "../../../core/models/State";
import { PresetPort } from "../../../core/ports/PresetPort";
import { AudioProvider } from "../AudioProvider";

export class InternetRadioAudioProvider implements AudioProvider {

    readonly mode: Mode = "internet_radio";

    private presetPort: PresetPort;

    private currentProcess: ChildProcessWithoutNullStreams | undefined;

    constructor(presetPort: PresetPort) {
        this.presetPort = presetPort;
    }

    async start(presetIndex: number): Promise<void> {
        if(this.currentProcess) {
            return;
        }

        if(presetIndex < 0 || presetIndex > this.presetPort.getMaxPresetIndex()) {
            console.error('[Internet Radio] Error playing station ' + presetIndex + '. PresetIndex out of bounds!')
            return;
        }
        const url = this.presetPort.getValueByPreset('internet_radio', presetIndex);
        if(!url) {
            console.error('[Internet Radio] Error playing station ' + presetIndex + '. No URL set!')
            return;
        }

        console.log('[Internet Radio] Playing internet radio station at ' + url);
        this.currentProcess = spawn('mpv', [
            url,
            '--no-video',
            '--volume=100',
            '--quiet'
        ]);

        this.currentProcess.stdout.on("data", (data) => {
            console.log(`[Internet Radio - mpv stdout]: ${data.toString()}`);
        });

        this.currentProcess.stderr.on("data", (data) => {
            console.error(`[Internet Radio - mpv stderr]: ${data.toString()}`);
        });

        this.currentProcess.on("exit", (code) => {
            console.log(`[Internet Radio - mpv exited] code: ${code}`);
        });
    }
    async stop(): Promise<void> {
        if(!this.currentProcess) {
            return;
        }
        try {
            this.currentProcess.kill();
            this.currentProcess = undefined;
            console.log("[Internet Radio] Stopped internet radio playback!");
        }catch {
            console.error("[Internet Radio] Error stopping internet radio playback!");
        }
    }

}