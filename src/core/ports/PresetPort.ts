export interface PresetPort {
    getRadioUrlByPreset(idx: number): string;
    getFMFrequencyByPreset(idx: number): number;

    setRadioUrlForPreset(idx: number, url: string): void;
    setFMFrequencyForPreset(idx: number, freq: number): void;
}