import { Mode } from "../models/State"

export interface AudioPort {
    playMode(mode: Mode, source?: any): Promise<void>;
    stop(): Promise<void>
    setVolume(vol: number): Promise<void>;
}