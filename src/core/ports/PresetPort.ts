import { Mode } from "../models/State";

export interface PresetPort {
    getValueByPreset(mode: "internet_radio" | "fm", presetIdx: number): string;

    getAllPresets(): {
        "internet_radio": string[]
        "fm": string[]
    };

    getMaxPresetIndex(): number;

    setValueForPreset(mode: "internet_radio" | "fm", presetIdx: number, value: string): void;

    onPresetsUpdated(callback: () => void): void
}