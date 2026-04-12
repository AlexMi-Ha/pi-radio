import { Mode } from "../models/State";

export interface InputPort {
    onVolumeChange(callback: (delta: number) => void): void;
    onFMFrequencyChange(callback: (delta: number) => void): void;
    onModeSelect(callback: (mode: Mode) => void): void;
    onPresetSelect(callback: (id: number) => void): void;
    onPowerToggle(callback: () => void): void;
}