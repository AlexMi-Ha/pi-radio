import { State, Mode } from "../../core/models/State";
import { OutputPort } from "../../core/ports/OutputPort";

export class MockOutputAdapter implements OutputPort {
    
    idle(): void {
        console.log("[Output] All LEDs set to idle")
    }
    initState(state: State): void {
        console.log("[Output] init output state with " + state);
    }
    setMode(mode: Mode): void {
        console.log("[Output] Set mode LED to " + mode)
    }
    setPresetState(preset: number): void {
        console.log("[Output] Set Preset LED to " + preset);
    }
    idlePresetState(): void {
        console.log("[Output] Returns Preset LEDs to idle position");
    }

}