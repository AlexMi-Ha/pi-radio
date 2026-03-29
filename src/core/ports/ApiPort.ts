import { Mode, Power, State} from "../models/State";

export interface ApiPort {
    onSetPower(callback: (state: Power) => Promise<void>): void;
    onSetMode(callback: (mode: Mode) => Promise<void>): void;
    onSetVolume(callback: (vol: number) => Promise<void>): void;
    onSetPreset(callback: (idx: number) => Promise<void>): void;

    onGetState(callback: () => State): void;
}