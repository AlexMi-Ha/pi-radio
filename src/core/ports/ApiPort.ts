import { Mode, Power, State} from "../models/State";

export interface ApiPort {
    onSetPower(callback: (state: Power) => void): void;
    onSetMode(callback: (mode: Mode) => void): void;
    onSetVolume(callback: (vol: number) => void): void;
    onSetPreset(callback: (idx: number) => void): void;

    onGetState(callback: () => State): void;
}