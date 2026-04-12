import { Mode } from "../../core/models/State";
import { AudioPort } from "../../core/ports/AudioPort";

export class MockAudioAdapter implements AudioPort {
    private currentMode: string | null = null;
    private currentStation: number | string | null = null;
    private volume: number = 50;
    
    playFMFreq(freq: number): Promise<void> {
        this.playFm(freq);
        return Promise.resolve();
    }

    setVolume(volume: number): Promise<void> {
        this.volume = Math.max(0, Math.min(100, volume));
        console.log(`[Audio] Volume set to ${this.volume}`);
        return Promise.resolve();
    }

    playRadio(station: number | string): void {
        this.currentMode = "internet_radio";
        this.currentStation = station;
        console.log(`[Audio] Playing Internet Radio station: ${station} at volume ${this.volume}`);
    }

    playFm(station: number | string): void {
        this.currentMode = "fm";
        this.currentStation = station;
        console.log(`[Audio] Playing FM station: ${station} at volume ${this.volume}`);
    }

    playBluetooth(): void {
        this.currentMode = "bluetooth";
        this.currentStation = null;
        console.log(`[Audio] Bluetooth mode enabled at volume ${this.volume}`);
    }

    playMode(mode: Mode, presetIndex: number): Promise<void> {
        switch(mode) {
            case "internet_radio":
                this.playRadio(presetIndex);
                break;
            case "bluetooth":
                this.playBluetooth();
                break;
            case "fm":
                this.playFm(presetIndex);
                break;
        }
        return Promise.resolve();
    }

    stop(): Promise<void> {
        console.log(`[Audio] Stopped playback`);
        this.currentMode = null;
        this.currentStation = null;
        return Promise.resolve();
    }

}