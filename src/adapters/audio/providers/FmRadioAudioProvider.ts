import { Mode } from "../../../core/models/State";
import { AudioProvider } from "../AudioProvider";

export class FmRadioAudioProvider implements AudioProvider {
    mode: Mode = "fm";

    start(presetIndex: number): Promise<void> {
        throw new Error("Method not implemented.");
    }

    changeFrequency(freq: number): Promise<void> {
        throw new Error("Method not implemented.");
    }

    initIfNotPlaying(): Promise<void> {
        throw new Error("Method not implemented.");
    }

    stop(): Promise<void> {
        throw new Error("Method not implemented.");
    }

}