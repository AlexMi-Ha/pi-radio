import { Mode, PresetMode } from "../models/State";

export interface PresetPort {
    getValueByPreset(mode: PresetMode, presetIdx: number): string;

    getAllPresets(mode: PresetMode): string[];

    getNumPresets(mode: PresetMode): number;

    setValueForPreset(mode: PresetMode, presetIdx: number, value: string): void;

    onPresetsUpdated(callback: () => void): void
}