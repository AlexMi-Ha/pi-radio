import { ApiAdapter } from "./adapters/api/ApiAdapter";
import { AudioAdapter } from "./adapters/audio/AudioAdapter";
import { InternetRadioAudioProvider } from "./adapters/audio/providers/InternetRadioAudioProvider";
import { MockInputAdapter } from "./adapters/input/MockInputAdapter";
import { MockOutputAdapter } from "./adapters/output/MockOutputAdapter";
import { InMemoryPresetAdapter } from "./adapters/preset/InMemoryPresetAdapter";
import { State } from "./core/models/State";
import { RadioController } from "./core/services/RadioController";


const initialState: State = {
  power: "power",
  mode: "internet_radio",
  volume: 50,
  preset: 1,
};

// -----------
// Adapters
// -----------
const inputAdapter = new MockInputAdapter();
const outputAdapter = new MockOutputAdapter();
const presetAdapter = new InMemoryPresetAdapter();
const audioAdapter = new AudioAdapter([new InternetRadioAudioProvider(presetAdapter)]);
const apiAdapter = new ApiAdapter(presetAdapter, 4200);

// ----------
// Core
// ----------

const controller = new RadioController({
    inputPort: inputAdapter,
    outputPort: outputAdapter,
    audioPort: audioAdapter,
    apiPort: apiAdapter,
    presetPort: presetAdapter,
    state: initialState
});

// -----------
// Initialize
// -----------

controller.init();

inputAdapter.start();
apiAdapter.start();

console.log("Smart Kitchen Radio DEV environment running...")
