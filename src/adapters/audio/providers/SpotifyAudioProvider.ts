import { ChildProcess, spawn } from "child_process";
import { Mode } from "../../../core/models/State";
import { AudioProvider } from "../AudioProvider";

export class SpotifyAudioProvider implements AudioProvider {
    readonly mode: Mode = "spotify";

    private spotifyProcess: ChildProcess | undefined;
    
    async start(presetIndex: number): Promise<void> {
        if (this.spotifyProcess) return;

        try {
            this.spotifyProcess = spawn("raspotify", {
                stdio: "ignore",
            });

            console.log("[Spotify] Raspotify started, device is now discoverable.");
        } catch (err) {
            console.error("[Spotify] Failed to start Raspotify:", err);
        }
    }
    
    async stop(): Promise<void> {
        if (!this.spotifyProcess) return;

        try {
            this.spotifyProcess.kill();
            this.spotifyProcess = undefined;
            console.log("[Spotify] Raspotify stopped, device is now hidden.");
        } catch (err) {
            console.error("[Spotify] Failed to stop Raspotify:", err);
        }
    }

}