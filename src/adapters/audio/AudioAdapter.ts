import { exec } from "child_process";
import { Mode } from "../../core/models/State";
import { AudioPort } from "../../core/ports/AudioPort";
import { clamp } from "../../core/util/util";
import { AudioProvider } from "./AudioProvider";

export class AudioAdapter implements AudioPort {

    private providers: Map<Mode, AudioProvider>;
    private currentProvider?: AudioProvider;
    private nowPlayingCallback?: (info: { title?: string, subtitle?: string }) => void;

    constructor(providers: AudioProvider[]) {
        this.providers = new Map(
            providers.map((p) => [p.mode, p])
        );
    }

    async playMode(mode: Mode, presetIndex: number): Promise<void> {
        await this.cycleProvider(mode);
        await this.currentProvider!.start(presetIndex);
    }

    async enablePairing(): Promise<void> {
        if(!this.currentProvider?.enablePairing) {
            throw new Error('[Audio] Current provider does not support pairing');
        }
        await this.currentProvider.enablePairing();
    }

    async stop(): Promise<void> {
        if(this.currentProvider) {
            await this.currentProvider.stop();
        }
    }

    async setVolume(vol: number): Promise<void> {
        await this.setSystemVolume(vol);
    }

    onNowPlayingChanged(callback: (info: { title?: string, subtitle?: string }) => void): void {
        this.nowPlayingCallback = callback;
    }

    private async cycleProvider(nextMode: Mode) {
        const nextProvider = this.providers.get(nextMode);
        if(!nextProvider) {
            throw new Error('[Audio] No audio provider found for ' + nextMode);
        }
        if(this.currentProvider) {
            await this.currentProvider.stop();
        }
        this.currentProvider = nextProvider;
        this.currentProvider.onNowPlayingChanged?.((info) => this.nowPlayingCallback?.(info));
    }

    private setSystemVolume(volume: number): Promise<void> {
        return new Promise((resolve,reject) => {
            const clampedVol = clamp(0, 100, volume);
            exec(`amixer set Master ${clampedVol}%`, (err) => {
                if(err) {
                    reject(err);
                }else {
                    resolve();
                }
            })
        })
    }
}
