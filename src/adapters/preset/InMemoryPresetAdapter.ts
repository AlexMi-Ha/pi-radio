import { PresetPort } from "../../core/ports/PresetPort";

export class InMemoryPresetAdapter implements PresetPort {

    private radioPresets: string[] = ["", "", "", "", ""];
    private fmPresets: string[] = ["", "", "", "", ""];


    getValueByPreset(mode: "internet_radio" | "fm", presetIdx: number): string {
        if(mode == "internet_radio") {
            return this.radioPresets[presetIdx]!;
        }else {
            return this.fmPresets[presetIdx]!;
        }
    }
    getAllPresets(): { "internet_radio": string[]; "fm": string[]; } {
        return {
            "internet_radio": this.radioPresets,
            "fm": this.fmPresets
        }
    }
    getMaxPresetIndex(): number {
        return this.radioPresets.length;
    }
    setValueForPreset(mode: "internet_radio" | "fm", presetIdx: number, value: string): void {
        if(mode == "internet_radio") {
            this.radioPresets[presetIdx] = value;
        }else {
            this.fmPresets[presetIdx] = value;
        }
    }

}