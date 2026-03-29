import { Mode } from "../../core/models/State";

export interface AudioProvider {

    readonly mode: Mode;

    start(source?: any): Promise<void>;
    stop() : Promise<void>;
}