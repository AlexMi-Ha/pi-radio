import { Mode, PresetMode } from "../models/State";

export interface Preset {
    name: string;
    value: string;
}

export interface PresetPort {
    getValueByPreset(mode: PresetMode, presetIdx: number): string;

    getNameByPreset(mode: PresetMode, presetIdx: number): string;

    getAllPresets(mode: PresetMode): Preset[];

    getNumPresets(mode: PresetMode): number;

    setValueForPreset(mode: PresetMode, presetIdx: number, value: string): void;

    setNameForPreset(mode: PresetMode, presetIdx: number, name: string): void;

    onPresetsUpdated(callback: () => void): void
}
