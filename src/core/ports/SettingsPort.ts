import { Mode } from "../models/State";

export interface Settings {
    mode: Mode;
    volume: number;
    preset: number;
}

export interface SettingsPort {
    load(): Settings | undefined;

    save(settings: Settings): void;
}
