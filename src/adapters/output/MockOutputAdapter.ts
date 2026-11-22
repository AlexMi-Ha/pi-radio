import { State, Mode } from "../../core/models/State";
import { OutputPort } from "../../core/ports/OutputPort";
import { logger } from "../../core/util/Logger";

export class MockOutputAdapter implements OutputPort {

    idle(): void {
        logger.log("[Output] All LEDs set to idle")
    }
    initState(state: State): void {
        logger.log("[Output] init output state with " + state);
    }
    setMode(mode: Mode): void {
        logger.log("[Output] Set mode LED to " + mode)
    }
    setPresetState(preset: number): void {
        logger.log("[Output] Set Preset LED to " + preset);
    }
    idlePresetState(): void {
        logger.log("[Output] Returns Preset LEDs to idle position");
    }
    setPairingState(active: boolean): void {
        logger.log("[Output] Pairing LED " + (active ? "on" : "off"));
    }

}
