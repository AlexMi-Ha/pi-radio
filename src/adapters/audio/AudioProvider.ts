import { Mode } from "../../core/models/State";

export interface AudioProvider {

    readonly mode: Mode;

    start(presetIndex: number): Promise<void>;
    stop() : Promise<void>;

    // Optional: providers that can report track metadata (e.g. ICY StreamTitle,
    // AVRCP) call this when it changes. Providers with no metadata source simply
    // never invoke it.
    onNowPlayingChanged?(callback: (info: { title?: string, subtitle?: string }) => void): void;

    // Optional: only meaningful for providers that support a pairing flow (Bluetooth).
    enablePairing?(): Promise<void>;
}
