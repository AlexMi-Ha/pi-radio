import { exec } from "child_process";
import { Mode } from "../../core/models/State";
import { AudioPort } from "../../core/ports/AudioPort";
import { clamp } from "../../core/util/util";
import { AudioProvider } from "./AudioProvider";
import { FmRadioAudioProvider } from "./providers/FmRadioAudioProvider";

export class AudioAdapter implements AudioPort {

    private providers: Map<Mode, AudioProvider>;
    private currentProvider?: AudioProvider;

    constructor(providers: AudioProvider[]) {
        this.providers = new Map(
            providers.map((p) => [p.mode, p])
        );
    }

    async playFMFreq(freq: number): Promise<void> {
        if(!this.currentProvider || this.currentProvider.mode != "fm") {
            await this.cycleProvider("fm");
        }
        const fmProvider = this.currentProvider as FmRadioAudioProvider;
        if(!fmProvider) {
            throw new Error('[Audio] Cannot access FM Radio Audio Provider');
        }
        await fmProvider.initIfNotPlaying();
        await fmProvider.changeFrequency(freq);
    }

    async playMode(mode: Mode, presetIndex: number): Promise<void> {
        await this.cycleProvider(mode);
        await this.currentProvider!.start(presetIndex);
    }

    async stop(): Promise<void> {
        if(this.currentProvider) {
            await this.currentProvider.stop();
        }
    }

    async setVolume(vol: number): Promise<void> {
        await this.setSystemVolume(vol);
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