import { ApiAdapter } from "./adapters/api/ApiAdapter";
import { AudioAdapter } from "./adapters/audio/AudioAdapter";
import { BluetoothAudioProvider } from "./adapters/audio/providers/BluetoothAudioProvider";
import { InternetRadioAudioProvider } from "./adapters/audio/providers/InternetRadioAudioProvider";
import { I2cLcdDisplayPort } from "./adapters/display/I2cLcdDisplayPort";
import { MockDisplayPort } from "./adapters/display/MockDisplayPort";
import { GpioInputAdapter } from "./adapters/input/GpioInputAdapter";
import { MockInputAdapter } from "./adapters/input/MockInputAdapter";
import { MockOutputAdapter } from "./adapters/output/MockOutputAdapter";
import { PersistentPresetAdapter } from "./adapters/preset/PersistentPresetAdapter";
import { State } from "./core/models/State";
import { RadioController } from "./core/services/RadioController";
import { configureFileLogging, logger } from "./core/util/Logger";

configureFileLogging(
  process.env.PI_RADIO_LOG_TO_FILE === "true",
  process.env.PI_RADIO_LOG_FILE_PATH ?? "logs/pi-radio.log",
  process.env.PI_RADIO_LOG_MAX_FILE_SIZE_BYTES
    ? parseInt(process.env.PI_RADIO_LOG_MAX_FILE_SIZE_BYTES, 10)
    : undefined,
  process.env.PI_RADIO_LOG_MAX_FILES ? parseInt(process.env.PI_RADIO_LOG_MAX_FILES, 10) : undefined
);

const initialState: State = {
  power: "idle",
  mode: "internet_radio",
  volume: 50,
  preset: 0,
  pairing: false,
  connected: false,
  muted: false,
  nowPlaying: {},
};

// -----------
// Adapters
// -----------
const useHardware = process.env.PI_RADIO_USE_HARDWARE === "true";

const inputAdapter = useHardware
  ? new GpioInputAdapter({
      powerButtonPin: parseInt(process.env.PI_RADIO_GPIO_POWER_BTN ?? "17", 10),
      modeButtonPin: parseInt(process.env.PI_RADIO_GPIO_MODE_BTN ?? "27", 10),
      actionButtonPin: parseInt(process.env.PI_RADIO_GPIO_ACTION_BTN ?? "22", 10),
      encoderAPin: parseInt(process.env.PI_RADIO_GPIO_ENCODER_A ?? "23", 10),
      encoderBPin: parseInt(process.env.PI_RADIO_GPIO_ENCODER_B ?? "24", 10),
      encoderButtonPin: parseInt(process.env.PI_RADIO_GPIO_ENCODER_BTN ?? "25", 10),
    })
  : new MockInputAdapter();

const outputAdapter = new MockOutputAdapter();

const displayAdapter = useHardware
  ? new I2cLcdDisplayPort({
      busNumber: parseInt(process.env.PI_RADIO_I2C_BUS ?? "1", 10),
      address: parseInt(process.env.PI_RADIO_I2C_LCD_ADDRESS ?? "0x27", 16),
    })
  : new MockDisplayPort();

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

logger.log("Smart Kitchen Radio DEV environment running...")
