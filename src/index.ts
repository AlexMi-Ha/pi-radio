import { ApiAdapter } from "./adapters/api/ApiAdapter";
import { AudioAdapter } from "./adapters/audio/AudioAdapter";
import { BluetoothAudioProvider } from "./adapters/audio/providers/BluetoothAudioProvider";
import { InternetRadioAudioProvider } from "./adapters/audio/providers/InternetRadioAudioProvider";
import { MockDisplayPort } from "./adapters/display/MockDisplayPort";
import { MockInputAdapter } from "./adapters/input/MockInputAdapter";
import { MockOutputAdapter } from "./adapters/output/MockOutputAdapter";
import { PersistentPresetAdapter } from "./adapters/preset/PersistentPresetAdapter";
import { State } from "./core/models/State";
import { RadioController } from "./core/services/RadioController";


const initialState: State = {
  power: "power",
  mode: "internet_radio",
  volume: 50,
  preset: 0,
  pairing: false,
  nowPlaying: {},
};

// -----------
// Adapters
// -----------
const inputAdapter = new MockInputAdapter();
const outputAdapter = new MockOutputAdapter();
const displayAdapter = new MockDisplayPort();

const presetAdapter = new PersistentPresetAdapter(process.env.PI_RADIO_PRESETS_PATH);

const audioAdapter = new AudioAdapter([
  new InternetRadioAudioProvider(presetAdapter),
  new BluetoothAudioProvider()
]);

const apiAdapter = new ApiAdapter(presetAdapter, 4200);

// ----------
// Core
// ----------

const controller = new RadioController({
    inputPort: inputAdapter,
    outputPort: outputAdapter,
    displayPort: displayAdapter,
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
