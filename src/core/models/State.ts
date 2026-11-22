export type Mode = "internet_radio" | "bluetooth";
export const _presetModes = ["internet_radio"] as const;
export type PresetMode = typeof _presetModes[number];
export type Power = "power" | "idle";

export function isPresetMode(mode: Mode | string): mode is PresetMode {
  return (_presetModes as readonly string[]).includes(mode);
}

export class State {
    power: Power;
    mode: Mode;
    volume: number;
    preset: number;
    pairing: boolean;
    muted: boolean;
    nowPlaying: { title?: string, subtitle?: string };

    constructor() {
        this.power = "idle";
        this.mode = "internet_radio";
        this.volume = 50;
        this.preset = 0;
        this.pairing = false;
        this.muted = false;
        this.nowPlaying = {};
    }
}
