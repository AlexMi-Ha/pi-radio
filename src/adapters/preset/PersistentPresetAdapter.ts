// src/adapters/preset/PersistentPresetAdapter.ts

import { Preset, PresetPort } from "../../core/ports/PresetPort";
import fs from "fs";
import path from "path";
import { _presetModes, PresetMode } from "../../core/models/State";
import { logger } from "../../core/util/Logger";

export class PersistentPresetAdapter implements PresetPort {
  private presets: Map<PresetMode, Preset[]>;
  private readonly filePath: string;
  private onUpdatedCallback?: () => void;
  private readonly maxPresets = 5;

  constructor(filePath?: string) {
    this.filePath = filePath || path.resolve(__dirname, "presets.json");

    if (fs.existsSync(this.filePath)) {
      try {
        const data = fs.readFileSync(this.filePath, "utf-8");
        const parsed = JSON.parse(data) as Record<string, (string | Preset)[]>;
        this.presets = new Map(
          Object.entries(parsed).map(([mode, slots]) => [mode as PresetMode, slots.map(this.toPreset)])
        );
        this.saveToFile();
      } catch (err) {
        logger.warn("[Preset] Failed to read presets file, initializing empty presets", err);
        this.presets = this.initEmptyPresets();
      }
    } else {
      this.presets = this.initEmptyPresets();
      this.saveToFile();
    }
  }

  private toPreset = (entry: string | Preset): Preset => {
    if (typeof entry === "string") {
      return { name: "", value: entry };
    }
    return { name: entry.name ?? "", value: entry.value ?? "" };
  };

  private initEmptyPresets(): Map<PresetMode, Preset[]> {
    const presets = new Map<PresetMode, Preset[]>();
    for(const presetMode of _presetModes) {
      presets.set(presetMode, this.emptySlots());
    }
    return presets;
  }

  private emptySlots(): Preset[] {
    return Array.from({ length: this.maxPresets }, () => ({ name: "", value: "" }));
  }

  private saveToFile(): void {
    try {
      const plain = Object.fromEntries(this.presets);
      fs.writeFileSync(this.filePath, JSON.stringify(plain, null, 2), "utf-8");
    } catch (err) {
      logger.error("[Preset] Failed to save presets to file:", err);
    }
  }

  getValueByPreset(mode: PresetMode, presetIdx: number): string {
    this.initPresetIfNotExist(mode);
    return this.presets.get(mode)![presetIdx]?.value || "";
  }

  getNameByPreset(mode: PresetMode, presetIdx: number): string {
    this.initPresetIfNotExist(mode);
    return this.presets.get(mode)![presetIdx]?.name || "";
  }

  getAllPresets(mode: PresetMode): Preset[] {
    this.initPresetIfNotExist(mode);
    return this.presets.get(mode)!;
  }

  getNumPresets(mode: PresetMode): number {
    this.initPresetIfNotExist(mode);
    return this.presets.get(mode)!.length;
  }

  setValueForPreset(mode: PresetMode, presetIdx: number, value: string): void {
    if(presetIdx < 0 || presetIdx >= this.maxPresets) {
      logger.error(`[Preset] Rejected preset index ${presetIdx}, must be within [0, ${this.maxPresets - 1}]`);
      return;
    }
    this.initPresetIfNotExist(mode);
    this.presets.get(mode)![presetIdx]!.value = value;
    this.saveToFile();
    this.onUpdatedCallback?.();
  }

  setNameForPreset(mode: PresetMode, presetIdx: number, name: string): void {
    if(presetIdx < 0 || presetIdx >= this.maxPresets) {
      logger.error(`[Preset] Rejected preset index ${presetIdx}, must be within [0, ${this.maxPresets - 1}]`);
      return;
    }
    this.initPresetIfNotExist(mode);
    this.presets.get(mode)![presetIdx]!.name = name;
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
    this.presets.set(mode, this.emptySlots());
    this.saveToFile();
  }
}
