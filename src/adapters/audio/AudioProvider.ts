import { Mode } from "../../core/models/State";

export interface AudioProvider {

    readonly mode: Mode;

    start(presetIndex: number): Promise<void>;
    stop() : Promise<void>;
}