import { RadioController } from '../../../src/core/services/RadioController';
import { AsyncProcessor } from '../../../src/core/util/AsyncProcessor';

// Mock AsyncProcessor to run immediately (no debounce complexity)
jest.mock('../../../src/core/util/AsyncProcessor', () => {
    return {
        AsyncProcessor: jest.fn().mockImplementation(() => ({
            runSafe: (fn: any) => fn()
        }))
    };
});

describe('RadioController', () => {

    let inputPort: any;
    let outputPort: any;
    let audioPort: any;
    let apiPort: any;
    let presetPort: any;
    let state: any;

    let controller: RadioController;

    beforeEach(() => {
        inputPort = {
            onModeSelect: jest.fn(),
            onPresetSelect: jest.fn(),
            onVolumeChange: jest.fn(),
            onPowerToggle: jest.fn(),
            onFMFrequencyChange: jest.fn()
        };

        outputPort = {
            setMode: jest.fn(),
            setPresetState: jest.fn(),
            idlePresetState: jest.fn(),
            idle: jest.fn()
        };

        audioPort = {
            playMode: jest.fn().mockResolvedValue(undefined),
            playFMFreq: jest.fn().mockResolvedValue(undefined),
            stop: jest.fn().mockResolvedValue(undefined),
            setVolume: jest.fn().mockResolvedValue(undefined)
        };

        apiPort = {
            onSetPower: jest.fn(),
            onGetState: jest.fn(),
            onSetMode: jest.fn(),
            onSetPreset: jest.fn(),
            onSetVolume: jest.fn()
        };

        presetPort = {
            onPresetsUpdated: jest.fn(),
            getNumPresets: jest.fn().mockResolvedValue(2),
            getValueByPreset: jest.fn().mockResolvedValue(1)
        };

        state = {
            power: "power",
            mode: "internet_radio",
            preset: 1,
            volume: 50
        };

        controller = new RadioController({
            inputPort,
            outputPort,
            audioPort,
            apiPort,
            presetPort,
            state
        });
    });

    // ------------------------
    // POWER
    // ------------------------

    test('turns power ON via input toggle', async () => {
        state.power = "idle";
        let handler: any;
        inputPort.onPowerToggle.mockImplementation((cb: any) => handler = cb);

        controller.init();

        await handler();
        await Promise.resolve();

        expect(state.power).toBe("power");
        expect(audioPort.playMode).toHaveBeenCalled();
        expect(audioPort.setVolume).toHaveBeenCalledWith(state.volume);
        expect(outputPort.setMode).toHaveBeenCalled();
        expect(outputPort.setPresetState).toHaveBeenCalled();
    });

    test('turns power OFF via input toggle', async () => {
        let handler: any;
        inputPort.onPowerToggle.mockImplementation((cb: any) => handler = cb);

        controller.init();

        await handler();

        expect(state.power).toBe("idle");
        expect(audioPort.stop).toHaveBeenCalled();
        expect(outputPort.idle).toHaveBeenCalled();
    });

    // ------------------------
    // MODE
    // ------------------------

    test('sets new mode via input', async () => {
        let handler: any;
        inputPort.onModeSelect.mockImplementation((cb: any) => handler = cb);

        controller.init();

        await handler("fm");

        expect(state.mode).toBe("fm");
        expect(outputPort.setMode).toHaveBeenCalledWith("fm");
        expect(outputPort.setPresetState).toHaveBeenCalled();
        expect(audioPort.playMode).toHaveBeenCalledWith("fm", state.preset);
    });

    test('does not re-run mode if same mode and not forced', async () => {
        let handler: any;
        inputPort.onModeSelect.mockImplementation((cb: any) => handler = cb);

        controller.init();

        await handler("internet_radio");

        expect(audioPort.playMode).not.toHaveBeenCalled();
    });

    test('forces mode update on presets updated event', async () => {
        let handler: any;
        presetPort.onPresetsUpdated.mockImplementation((cb: any) => handler = cb);

        controller.init();

        await handler();

        expect(audioPort.playMode).toHaveBeenCalled();
    });

    // ------------------------
    // PRESET
    // ------------------------

    test('sets preset when in internet_radio mode', async () => {
        let handler: any;
        inputPort.onPresetSelect.mockImplementation((cb: any) => handler = cb);

        controller.init();

        await handler(4);

        expect(state.preset).toBe(4);
        expect(outputPort.setPresetState).toHaveBeenCalledWith(4);
        expect(audioPort.playMode).toHaveBeenCalledWith("internet_radio", 4);
    });

    test('sets preset when in fm mode', async () => {
        state.mode = "fm";

        let handler: any;
        inputPort.onPresetSelect.mockImplementation((cb: any) => handler = cb);

        controller.init();

        await handler(4);

        expect(state.preset).toBe(4);
        expect(outputPort.setPresetState).toHaveBeenCalledWith(4);
        expect(audioPort.playMode).toHaveBeenCalledWith("fm", 4);
    });

    test('ignores preset change in invalid bt mode', async () => {
        state.mode = "bluetooth";

        let handler: any;
        inputPort.onPresetSelect.mockImplementation((cb: any) => handler = cb);

        controller.init();

        await handler(4);

        expect(audioPort.playMode).not.toHaveBeenCalled();
    });

    test('ignores preset if same value', async () => {
        state.mode = "fm";
        state.preset = 3;

        let handler: any;
        inputPort.onPresetSelect.mockImplementation((cb: any) => handler = cb);

        controller.init();

        await handler(3);

        expect(audioPort.playMode).not.toHaveBeenCalled();
    });

    // ------------------------
    // VOLUME
    // ------------------------

    test('updates volume with clamp', async () => {
        let handler: any;
        inputPort.onVolumeChange.mockImplementation((cb: any) => handler = cb);

        controller.init();

        await handler(20); // delta

        expect(state.volume).toBe(70);
        expect(audioPort.setVolume).toHaveBeenCalledWith(70);
    });

    test('volume cannot go below 0', async () => {
        state.volume = 10;

        let handler: any;
        inputPort.onVolumeChange.mockImplementation((cb: any) => handler = cb);

        controller.init();

        await handler(-50);

        expect(state.volume).toBe(0);
        expect(audioPort.setVolume).toHaveBeenCalledWith(0);
    });

    // ------------------------
    // API
    // ------------------------

    test('api setPower triggers logic', async () => {
        state.power = "idle";
        let handler: any;
        apiPort.onSetPower.mockImplementation((cb: any) => handler = cb);

        controller.init();

        await handler("power");

        expect(state.power).toBe("power");
        expect(audioPort.playMode).toHaveBeenCalled();
    });

    test('api getState returns state', () => {
        let handler: any;
        apiPort.onGetState.mockImplementation((cb: any) => handler = cb);

        controller.init();

        const result = handler();

        expect(result).toBe(state);
    });

    test('api setVolume works', async () => {
        let handler: any;
        apiPort.onSetVolume.mockImplementation((cb: any) => handler = cb);

        controller.init();

        await handler(55);

        expect(state.volume).toBe(55);
        expect(audioPort.setVolume).toHaveBeenCalledWith(55);
    });

});