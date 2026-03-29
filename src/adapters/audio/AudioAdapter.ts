import { exec } from "child_process";
import { Mode } from "../../core/models/State";
import { AudioPort } from "../../core/ports/AudioPort";
import { clamp } from "../../core/util/util";
import { AudioProvider } from "./AudioProvider";

export class AudioAdapter implements AudioPort {

    private providers: Map<Mode, AudioProvider>;
    private currentProvider?: AudioProvider;

    constructor(providers: AudioProvider[]) {
        this.providers = new Map(
            providers.map((p) => [p.mode, p])
        );
    }

    async playMode(mode: Mode, presetIndex: number): Promise<void> {
        const nextProvider = this.providers.get(mode);
        if(!nextProvider) {
            throw new Error('No audio provider found for ' + mode);
        }
        if(this.currentProvider) {
            await this.currentProvider.stop();
        }
        this.currentProvider = nextProvider;
        await this.currentProvider.start(presetIndex);
    }

    async stop(): Promise<void> {
        if(this.currentProvider) {
            await this.currentProvider.stop();
        }
    }

    async setVolume(vol: number): Promise<void> {
        await this.setSystemVolume(vol);
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