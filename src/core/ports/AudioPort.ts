export interface AudioPort {
    playRadio(url: string): void
    playBluetooth(): void
    playSpotify(): void
    playFm(freq: number): void
    stop(): void
    setVolume(vol: number): void
}