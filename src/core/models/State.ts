export type Mode = "internet_radio" | "bluetooth" | "fm";
export const _presetModes = ["internet_radio","fm"] as const;
export type PresetMode = typeof _presetModes[number];
export type Power = "power" | "idle";

export const FM_FREQ_MIN = 88;
export const FM_FREQ_MAX = 108;

export function isPresetMode(mode: Mode | string): mode is PresetMode {
  return (_presetModes as readonly string[]).includes(mode);
}

export class State {
    power: Power;
    mode: Mode;
    volume: number;
    preset: number; 
    freq: number;

    constructor() {
        this.power = "idle";
        this.mode = "internet_radio";
        this.volume = 50;
        this.preset = 0;
        this.freq = 0;
    }
}