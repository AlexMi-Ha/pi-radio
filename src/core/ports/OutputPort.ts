import { Mode, State } from "../models/State"

export interface OutputPort {
    idle(): void
    initState(state: State): void

    setMode(mode: Mode) : void
    setPresetState(preset : number): void
    idlePresetState() : void
    setPairingState(active: boolean): void
}
