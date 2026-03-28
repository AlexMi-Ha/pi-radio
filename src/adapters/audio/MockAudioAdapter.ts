import { AudioPort } from "../../core/ports/AudioPort";

export class MockAudioAdapter implements AudioPort {
    private currentMode: string | null = null;
    private currentStation: number | string | null = null;
    private volume: number = 50;

    setVolume(volume: number): void {
        this.volume = Math.max(0, Math.min(100, volume));
        console.log(`[Audio] Volume set to ${this.volume}`);
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

    playSpotify(): void {
        this.currentMode = "spotify";
        this.currentStation = null;
        console.log(`[Audio] Spotify mode enabled at volume ${this.volume}`);
    }

    stop(): void {
        console.log(`[Audio] Stopped playback`);
        this.currentMode = null;
        this.currentStation = null;
    }

}