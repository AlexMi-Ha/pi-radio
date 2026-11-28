import { ChildProcessWithoutNullStreams, spawn } from "child_process";
import fs from "fs";
import net, { Socket } from "net";
import os from "os";
import path from "path";
import { Mode } from "../../../core/models/State";
import { PresetPort } from "../../../core/ports/PresetPort";
import { AudioProvider } from "../AudioProvider";
import { logger } from "../../../core/util/Logger";

export class InternetRadioAudioProvider implements AudioProvider {

    readonly mode: Mode = "internet_radio";

    private presetPort: PresetPort;

    private currentProcess: ChildProcessWithoutNullStreams | undefined;
    private ipcSocket: Socket | undefined;
    private ipcPath: string | undefined;
    private nowPlayingCallback?: (info: { title?: string, subtitle?: string, loading?: boolean }) => void;

    constructor(presetPort: PresetPort) {
        this.presetPort = presetPort;
    }

    onNowPlayingChanged(callback: (info: { title?: string, subtitle?: string, loading?: boolean }) => void): void {
        this.nowPlayingCallback = callback;
    }

    async start(presetIndex: number): Promise<void> {
        if(this.currentProcess) {
            return;
        }

        if(presetIndex < 0 || presetIndex > this.presetPort.getNumPresets("internet_radio")) {
            logger.error('[Internet Radio] Error playing station ' + presetIndex + '. PresetIndex out of bounds!')
            return;
        }
        const url = this.presetPort.getValueByPreset('internet_radio', presetIndex);
        if(!url) {
            logger.error('[Internet Radio] Error playing station ' + presetIndex + '. No URL set!')
            return;
        }

        logger.log('[Internet Radio] Playing internet radio station at ' + url);
        this.nowPlayingCallback?.({ loading: true });

        // Unique per invocation (not just per Node process) so a restarting mpv instance
        // can never race the previous one for the same socket path.
        const ipcPath = path.join(os.tmpdir(), `pi-radio-mpv-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.sock`);
        this.ipcPath = ipcPath;

        this.currentProcess = spawn('mpv', [
            url,
            '--no-video',
            '--volume=100',
            '--quiet',
            `--input-ipc-server=${ipcPath}`
        ]);

        this.currentProcess.stdout.on("data", (data) => {
            logger.log(`[Internet Radio - mpv stdout]: ${data.toString()}`);
        });

        this.currentProcess.stderr.on("data", (data) => {
            logger.error(`[Internet Radio - mpv stderr]: ${data.toString()}`);
        });

        this.currentProcess.on("exit", (code) => {
            logger.log(`[Internet Radio - mpv exited] code: ${code}`);
            // Must unlink the path captured for THIS process, not this.ipcPath, which may
            // already belong to a newer process by the time this (delayed) exit fires.
            fs.unlink(ipcPath, () => {});
        });

        this.connectIpc(ipcPath, this.currentProcess);
    }

    private connectIpc(ipcPath: string, proc: ChildProcessWithoutNullStreams, attempt: number = 0): void {
        if(this.currentProcess !== proc) {
            // A newer station has since started; this (possibly retrying) connection
            // attempt belongs to a process that is no longer current.
            return;
        }
        // mpv creates the IPC socket asynchronously shortly after spawn, so retry briefly.
        const socket = net.createConnection(ipcPath, () => {
            socket.write(JSON.stringify({ command: ["observe_property", 1, "metadata"] }) + "\n");
        });

        socket.on("data", (chunk) => {
            for(const line of chunk.toString().split("\n")) {
                if(!line.trim()) continue;
                try {
                    const msg = JSON.parse(line);
                    // mpv only recomputes media-title once (falling back to the stream URL);
                    // ICY title changes mid-stream show up as metadata updates instead.
                    if(msg.event === "property-change" && msg.name === "metadata" && msg.data && typeof msg.data === "object") {
                        const icyTitle = msg.data["icy-title"];
                        const title = typeof icyTitle === "string" && icyTitle.length > 0 ? icyTitle : undefined;
                        // Receiving any metadata event at all means the stream has
                        // started, which is also our only "no longer loading" signal.
                        this.nowPlayingCallback?.(title !== undefined ? { title } : {});
                    }
                }catch {
                    // ignore malformed/partial lines
                }
            }
        });

        socket.on("error", () => {
            if(attempt < 20 && this.currentProcess === proc) {
                setTimeout(() => this.connectIpc(ipcPath, proc, attempt + 1), 250);
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
            logger.log("[Internet Radio] Stopped internet radio playback!");
        }catch {
            logger.error("[Internet Radio] Error stopping internet radio playback!");
        }
    }

}
