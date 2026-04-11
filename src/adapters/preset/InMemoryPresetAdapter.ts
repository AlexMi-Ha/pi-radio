import { _presetModes, PresetMode } from "../../core/models/State";
import { PresetPort } from "../../core/ports/PresetPort";

export class InMemoryPresetAdapter implements PresetPort {

    onUpdatedCallback?: () => void;

    private presets = new Map<PresetMode, string[]>();

    constructor() {
        for(const presetMode of _presetModes) {
            this.presets.set(presetMode, ["", "", "", "", ""])
        }
    }


    getValueByPreset(mode: PresetMode, presetIdx: number): string {
        return this.presets.get(mode)![presetIdx] ?? "";
    }
    getAllPresets(mode: PresetMode): string[] {
        return this.presets.get(mode)!;
    }
    getNumPresets(mode: PresetMode): number {
        return this.presets.get(mode)!.length;
    }
    setValueForPreset(mode: PresetMode, presetIdx: number, value: string): void {
        this.presets.get(mode)![presetIdx] = value;
        this.onUpdatedCallback?.()
    }

    onPresetsUpdated(callback: () => void): void {
        this.onUpdatedCallback = callback;
    }
}