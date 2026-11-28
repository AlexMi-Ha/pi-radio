import { Mode } from "../models/State"

export interface AudioPort {
    playMode(mode: Mode, presetIndex: number): Promise<void>;
    enablePairing(): Promise<void>;
    stop(): Promise<void>;
    setVolume(vol: number): Promise<void>;
    onNowPlayingChanged(callback: (info: { title?: string, subtitle?: string, loading?: boolean }) => void): void;
    onConnectionChanged(callback: (connected: boolean) => void): void;
}
