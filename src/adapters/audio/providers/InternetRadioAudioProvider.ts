import { ChildProcessWithoutNullStreams, spawn } from "child_process";
import net, { Socket } from "net";
import os from "os";
import path from "path";
import { Mode } from "../../../core/models/State";
import { PresetPort } from "../../../core/ports/PresetPort";
import { AudioProvider } from "../AudioProvider";

export class InternetRadioAudioProvider implements AudioProvider {

    readonly mode: Mode = "internet_radio";

    private presetPort: PresetPort;

    private currentProcess: ChildProcessWithoutNullStreams | undefined;
    private ipcSocket: Socket | undefined;
    private ipcPath: string | undefined;
    private nowPlayingCallback?: (info: { title?: string, subtitle?: string }) => void;

    constructor(presetPort: PresetPort) {
        this.presetPort = presetPort;
    }

    onNowPlayingChanged(callback: (info: { title?: string, subtitle?: string }) => void): void {
        this.nowPlayingCallback = callback;
    }

    async start(presetIndex: number): Promise<void> {
        if(this.currentProcess) {
            return;
        }

        if(presetIndex < 0 || presetIndex > this.presetPort.getNumPresets("internet_radio")) {
            console.error('[Internet Radio] Error playing station ' + presetIndex + '. PresetIndex out of bounds!')
            return;
        }
        const url = this.presetPort.getValueByPreset('internet_radio', presetIndex);
        if(!url) {
            console.error('[Internet Radio] Error playing station ' + presetIndex + '. No URL set!')
            return;
        }

        console.log('[Internet Radio] Playing internet radio station at ' + url);

        this.ipcPath = path.join(os.tmpdir(), `pi-radio-mpv-${process.pid}.sock`);

        this.currentProcess = spawn('mpv', [
            url,
            '--no-video',
            '--volume=100',
            '--quiet',
            `--input-ipc-server=${this.ipcPath}`
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

        this.connectIpc();
    }

    private connectIpc(attempt: number = 0): void {
        if(!this.ipcPath || !this.currentProcess) {
            return;
        }
        // mpv creates the IPC socket asynchronously shortly after spawn, so retry briefly.
        const socket = net.createConnection(this.ipcPath, () => {
            socket.write(JSON.stringify({ command: ["observe_property", 1, "media-title"] }) + "\n");
        });

        socket.on("data", (chunk) => {
            for(const line of chunk.toString().split("\n")) {
                if(!line.trim()) continue;
                try {
                    const msg = JSON.parse(line);
                    if(msg.event === "property-change" && msg.name === "media-title") {
                        const title = typeof msg.data === "string" && msg.data.length > 0 ? msg.data : undefined;
                        this.nowPlayingCallback?.({ title });
                    }
                }catch {
                    // ignore malformed/partial lines
                }
            }
        });

        socket.on("error", () => {
            if(attempt < 20 && this.currentProcess) {
                setTimeout(() => this.connectIpc(attempt + 1), 250);
            }
        });

        this.ipcSocket = socket;
    }

    async stop(): Promise<void> {
        if(this.ipcSocket) {
            this.ipcSocket.destroy();
            this.ipcSocket = undefined;
        }
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
