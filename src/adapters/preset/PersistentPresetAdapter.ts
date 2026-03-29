// src/adapters/preset/PersistentPresetAdapter.ts

import { PresetPort } from "../../core/ports/PresetPort";
import fs from "fs";
import path from "path";

type Mode = "internet_radio" | "fm";

interface PresetData {
  internet_radio: string[];
  fm: string[];
}

export class PersistentPresetAdapter implements PresetPort {
  private presets: PresetData;
  private readonly filePath: string;
  private onUpdatedCallback?: () => void;
  private readonly maxPresets = 5;

  constructor(filePath?: string) {
    this.filePath = filePath || path.resolve(__dirname, "presets.json");

    if (fs.existsSync(this.filePath)) {
      try {
        const data = fs.readFileSync(this.filePath, "utf-8");
        this.presets = JSON.parse(data) as PresetData;
      } catch (err) {
        console.warn("[Preset] Failed to read presets file, initializing empty presets", err);
        this.presets = this.initEmptyPresets();
      }
    } else {
      this.presets = this.initEmptyPresets();
      this.saveToFile();
    }
  }

  private initEmptyPresets(): PresetData {
    return {
      internet_radio: Array(this.maxPresets).fill(""),
      fm: Array(this.maxPresets).fill(""),
    };
  }

  private saveToFile(): void {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.presets, null, 2), "utf-8");
    } catch (err) {
      console.error("[Preset] Failed to save presets to file:", err);
    }
  }

  getValueByPreset(mode: Mode, presetIdx: number): string {
    return this.presets[mode][presetIdx] || "";
  }

  getAllPresets(): { internet_radio: string[]; fm: string[] } {
    return { ...this.presets };
  }

  getMaxPresetIndex(): number {
    return this.maxPresets;
  }

  setValueForPreset(mode: Mode, presetIdx: number, value: string): void {
    this.presets[mode][presetIdx] = value;
    this.saveToFile();
    this.onUpdatedCallback?.();
  }

  onPresetsUpdated(callback: () => void): void {
    this.onUpdatedCallback = callback;
  }
}