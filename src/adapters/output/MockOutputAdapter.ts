import { State, Mode } from "../../core/models/State";
import { OutputPort } from "../../core/ports/OutputPort";

export class MockOutputAdapter implements OutputPort {
    
    idle(): void {
        console.log("All LEDs set to idle")
    }
    initState(state: State): void {
        console.log("init output state with " + state);
    }
    setMode(mode: Mode): void {
        console.log("Set mode LED to " + mode)
    }
    setPresetState(preset: number): void {
        console.log("Set Preset LED to " + preset);
    }
    idlePresetState(): void {
        console.log("Returns Preset LEDs to idle position");
    }

}