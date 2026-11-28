import { ApiAdapter } from "./adapters/api/ApiAdapter";
import { AudioAdapter } from "./adapters/audio/AudioAdapter";
import { BluetoothAudioProvider } from "./adapters/audio/providers/BluetoothAudioProvider";
import { InternetRadioAudioProvider } from "./adapters/audio/providers/InternetRadioAudioProvider";
import { AipI2cLcdDisplayPort } from "./adapters/display/AipI2cLcdDisplayPort";
import { MockDisplayPort } from "./adapters/display/MockDisplayPort";
import { GpioInputAdapter } from "./adapters/input/GpioInputAdapter";
import { MockInputAdapter } from "./adapters/input/MockInputAdapter";
import { MockOutputAdapter } from "./adapters/output/MockOutputAdapter";
import { PersistentPresetAdapter } from "./adapters/preset/PersistentPresetAdapter";
import { PersistentSettingsAdapter } from "./adapters/settings/PersistentSettingsAdapter";
import { DisplayPort } from "./core/ports/DisplayPort";
import { InputPort } from "./core/ports/InputPort";
import { State } from "./core/models/State";
import { RadioController } from "./core/services/RadioController";
import { configureFileLogging, logger } from "./core/util/Logger";

function envInt(name: string, fallback: number, radix = 10): number {
  const raw = process.env[name];
  return raw !== undefined ? parseInt(raw, radix) : fallback;
}

function envIntOptional(name: string): number | undefined {
  const raw = process.env[name];
  return raw !== undefined ? parseInt(raw, 10) : undefined;
}

configureFileLogging(
  process.env.PI_RADIO_LOG_TO_FILE === "true",
  process.env.PI_RADIO_LOG_FILE_PATH ?? "logs/pi-radio.log",
  envIntOptional("PI_RADIO_LOG_MAX_FILE_SIZE_BYTES"),
  envIntOptional("PI_RADIO_LOG_MAX_FILES")
);

function createInputAdapter(useHardware: boolean): InputPort & { start(): void } {
  if (!useHardware) {
    return new MockInputAdapter();
  }
  return new GpioInputAdapter({
    powerButtonPin: envInt("PI_RADIO_GPIO_POWER_BTN", 17),
    modeButtonPin: envInt("PI_RADIO_GPIO_MODE_BTN", 27),
    actionButtonPin: envInt("PI_RADIO_GPIO_ACTION_BTN", 22),
    encoderAPin: envInt("PI_RADIO_GPIO_ENCODER_A", 23),
    encoderBPin: envInt("PI_RADIO_GPIO_ENCODER_B", 24),
    encoderButtonPin: envInt("PI_RADIO_GPIO_ENCODER_BTN", 25),
    volumeStepPerDetent: envInt("PI_RADIO_VOLUME_STEP", 6),
  });
}

function createDisplayAdapter(useHardware: boolean): DisplayPort {
  if (!useHardware) {
    return new MockDisplayPort();
  }
  return new AipI2cLcdDisplayPort({
    busNumber: envInt("PI_RADIO_I2C_BUS", 1),
    address: envInt("PI_RADIO_I2C_LCD_ADDRESS", 0x3e, 16),
  });
}

// -----------
// Adapters
// -----------
const useHardware = process.env.PI_RADIO_USE_HARDWARE === "true";
logger.log(`[Startup] Using ${useHardware ? "hardware" : "mock"} input/display adapters (PI_RADIO_USE_HARDWARE=${process.env.PI_RADIO_USE_HARDWARE ?? "unset"})`);

const inputAdapter = createInputAdapter(useHardware);
const outputAdapter = new MockOutputAdapter();
const displayAdapter = createDisplayAdapter(useHardware);

const settingsAdapter = new PersistentSettingsAdapter(process.env.PI_RADIO_SETTINGS_PATH);
const presetAdapter = new PersistentPresetAdapter(process.env.PI_RADIO_PRESETS_PATH);

const audioAdapter = new AudioAdapter([
  new InternetRadioAudioProvider(presetAdapter),
  new BluetoothAudioProvider(),
]);

const apiAdapter = new ApiAdapter(presetAdapter, 4200);

// ----------
// Core
// ----------
const savedSettings = settingsAdapter.load();
logger.log(savedSettings
  ? `[Startup] Restored settings: mode=${savedSettings.mode}, volume=${savedSettings.volume}, preset=${savedSettings.preset}`
  : "[Startup] No saved settings found, using defaults");

const initialState: State = {
  power: "idle",
  mode: savedSettings?.mode ?? "internet_radio",
  volume: savedSettings?.volume ?? 50,
  preset: savedSettings?.preset ?? 0,
  pairing: false,
  connected: false,
  muted: false,
  nowPlaying: {},
};

const controller = new RadioController({
  inputPort: inputAdapter,
  outputPort: outputAdapter,
  displayPort: displayAdapter,
  audioPort: audioAdapter,
  apiPort: apiAdapter,
  presetPort: presetAdapter,
  settingsPort: settingsAdapter,
  state: initialState,
});

// -----------
// Shutdown
// -----------
function shutdown(signal: NodeJS.Signals): void {
  logger.log(`[Shutdown] Received ${signal}, clearing display and exiting.`);
  displayAdapter.clear();
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

// -----------
// Initialize
// -----------
displayAdapter.playBootAnimation(() => {
  controller.init();

  inputAdapter.start();
  apiAdapter.start();

  logger.log("Smart Kitchen Radio DEV environment running...");
});
