import { _presetModes, PresetMode } from "../../core/models/State";
import { Preset, PresetPort } from "../../core/ports/PresetPort";

export class InMemoryPresetAdapter implements PresetPort {

    onUpdatedCallback?: () => void;

    private presets = new Map<PresetMode, Preset[]>();

    constructor() {
        for(const presetMode of _presetModes) {
            this.presets.set(presetMode, this.emptySlots())
        }
    }

    private emptySlots(): Preset[] {
        return Array.from({ length: 5 }, () => ({ name: "", value: "" }));
    }

    getValueByPreset(mode: PresetMode, presetIdx: number): string {
        return this.presets.get(mode)![presetIdx]?.value ?? "";
    }
    getNameByPreset(mode: PresetMode, presetIdx: number): string {
        return this.presets.get(mode)![presetIdx]?.name ?? "";
    }
    getAllPresets(mode: PresetMode): Preset[] {
        return this.presets.get(mode)!;
    }
    getNumPresets(mode: PresetMode): number {
        return this.presets.get(mode)!.length;
    }
    setValueForPreset(mode: PresetMode, presetIdx: number, value: string): void {
        this.presets.get(mode)![presetIdx]!.value = value;
        this.onUpdatedCallback?.()
    }
    setNameForPreset(mode: PresetMode, presetIdx: number, name: string): void {
        this.presets.get(mode)![presetIdx]!.name = name;
        this.onUpdatedCallback?.()
    }

    onPresetsUpdated(callback: () => void): void {
        this.onUpdatedCallback = callback;
    }
}
