// src/adapters/preset/PersistentPresetAdapter.ts

import { PresetPort } from "../../core/ports/PresetPort";
import fs from "fs";
import path from "path";
import { _presetModes, PresetMode } from "../../core/models/State";

export class PersistentPresetAdapter implements PresetPort {
  private presets: Map<PresetMode, string[]>;
  private readonly filePath: string;
  private onUpdatedCallback?: () => void;
  private readonly maxPresets = 5;

  constructor(filePath?: string) {
    this.filePath = filePath || path.resolve(__dirname, "presets.json");

    if (fs.existsSync(this.filePath)) {
      try {
        const data = fs.readFileSync(this.filePath, "utf-8");
        const parsed = JSON.parse(data) as Record<string, string[]>;
        this.presets = new Map(Object.entries(parsed)) as Map<PresetMode, string[]>;
      } catch (err) {
        console.warn("[Preset] Failed to read presets file, initializing empty presets", err);
        this.presets = this.initEmptyPresets();
      }
    } else {
      this.presets = this.initEmptyPresets();
      this.saveToFile();
    }
  }

  private initEmptyPresets(): Map<PresetMode, string[]> {
    const presets = new Map<PresetMode, string[]>();
    for(const presetMode of _presetModes) {
      presets.set(presetMode, new Array(this.maxPresets).fill(""));
    }
    return presets;
  }

  private saveToFile(): void {
    try {
      const plain = Object.fromEntries(this.presets);
      fs.writeFileSync(this.filePath, JSON.stringify(plain, null, 2), "utf-8");
    } catch (err) {
      console.error("[Preset] Failed to save presets to file:", err);
    }
  }

  getValueByPreset(mode: PresetMode, presetIdx: number): string {
    this.initPresetIfNotExist(mode);
    return this.presets.get(mode)![presetIdx] || "";
  }

  getAllPresets(mode: PresetMode): string[] {
    this.initPresetIfNotExist(mode);
    return this.presets.get(mode)!;
  }

  getNumPresets(mode: PresetMode): number {
    this.initPresetIfNotExist(mode);
    return this.presets.get(mode)!.length;
  }

  setValueForPreset(mode: PresetMode, presetIdx: number, value: string): void {
    if(presetIdx < 0 || presetIdx >= this.maxPresets) {
      console.error(`[Preset] Rejected preset index ${presetIdx}, must be within [0, ${this.maxPresets - 1}]`);
      return;
    }
    this.initPresetIfNotExist(mode);
    this.presets.get(mode)![presetIdx] = value;
    this.saveToFile();
    this.onUpdatedCallback?.();
  }

  onPresetsUpdated(callback: () => void): void {
    this.onUpdatedCallback = callback;
  }

  private initPresetIfNotExist(mode: PresetMode) {
    if(this.presets.has(mode)) {
      return;
    }
    this.presets.set(mode, new Array(this.maxPresets).fill(""));
    this.saveToFile();
  }
}
