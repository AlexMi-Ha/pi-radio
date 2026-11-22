import { RadioController } from '../../../src/core/services/RadioController';

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
    let displayPort: any;
    let audioPort: any;
    let apiPort: any;
    let presetPort: any;
    let settingsPort: any;
    let state: any;

    let controller: RadioController;

    beforeEach(() => {
        inputPort = {
            onModeToggle: jest.fn(),
            onActionPress: jest.fn(),
            onVolumeChange: jest.fn(),
            onVolumeMute: jest.fn(),
            onPowerToggle: jest.fn()
        };

        outputPort = {
            setMode: jest.fn(),
            setPresetState: jest.fn(),
            idlePresetState: jest.fn(),
            setPairingState: jest.fn(),
            idle: jest.fn()
        };

        displayPort = {
            showLines: jest.fn(),
            showTransient: jest.fn(),
            setPower: jest.fn()
        };

        audioPort = {
            playMode: jest.fn().mockResolvedValue(undefined),
            enablePairing: jest.fn().mockResolvedValue(undefined),
            stop: jest.fn().mockResolvedValue(undefined),
            setVolume: jest.fn().mockResolvedValue(undefined),
            onNowPlayingChanged: jest.fn(),
            onConnectionChanged: jest.fn()
        };

        apiPort = {
            onSetPower: jest.fn(),
            onGetState: jest.fn(),
            onSetMode: jest.fn(),
            onSetPreset: jest.fn(),
            onSetVolume: jest.fn(),
            onSetMute: jest.fn()
        };

        presetPort = {
            onPresetsUpdated: jest.fn(),
            getNumPresets: jest.fn().mockReturnValue(5),
            getValueByPreset: jest.fn().mockReturnValue('http://example.com/station'),
            getNameByPreset: jest.fn().mockReturnValue('')
        };

        settingsPort = {
            load: jest.fn().mockReturnValue(undefined),
            save: jest.fn()
        };

        state = {
            power: "power",
            mode: "internet_radio",
            preset: 1,
            volume: 50,
            pairing: false,
            connected: false,
            muted: false,
            nowPlaying: {}
        };

        controller = new RadioController({
            inputPort,
            outputPort,
            displayPort,
            audioPort,
            apiPort,
            presetPort,
            settingsPort,
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
        expect(displayPort.setPower).toHaveBeenCalledWith(true);
    });

    test('turns power OFF via input toggle', async () => {
        let handler: any;
        inputPort.onPowerToggle.mockImplementation((cb: any) => handler = cb);

        controller.init();

        await handler();

        expect(state.power).toBe("idle");
        expect(audioPort.stop).toHaveBeenCalled();
        expect(outputPort.idle).toHaveBeenCalled();
        expect(displayPort.setPower).toHaveBeenCalledWith(false);
    });

    test('persists mode/volume/preset via settingsPort when turning power OFF', async () => {
        state.mode = "internet_radio";
        state.preset = 3;
        state.volume = 42;

        let handler: any;
        inputPort.onPowerToggle.mockImplementation((cb: any) => handler = cb);

        controller.init();

        await handler();

        expect(settingsPort.save).toHaveBeenCalledWith({
            mode: "internet_radio",
            volume: 42,
            preset: 3
        });
    });

    test('does not persist settings via settingsPort when turning power ON', async () => {
        state.power = "idle";
        let handler: any;
        inputPort.onPowerToggle.mockImplementation((cb: any) => handler = cb);

        controller.init();

        await handler();

        expect(settingsPort.save).not.toHaveBeenCalled();
    });

    // ------------------------
    // MODE
    // ------------------------

    test('toggles mode from internet_radio to bluetooth via input', async () => {
        let handler: any;
        inputPort.onModeToggle.mockImplementation((cb: any) => handler = cb);

        controller.init();

        await handler();

        expect(state.mode).toBe("bluetooth");
        expect(outputPort.setMode).toHaveBeenCalledWith("bluetooth");
        expect(outputPort.idlePresetState).toHaveBeenCalled();
        expect(audioPort.playMode).toHaveBeenCalledWith("bluetooth", 0);
    });

    test('toggles mode back to internet_radio on second toggle', async () => {
        let handler: any;
        inputPort.onModeToggle.mockImplementation((cb: any) => handler = cb);

        controller.init();

        await handler();
        await handler();

        expect(state.mode).toBe("internet_radio");
    });

    test('does not re-run mode via api if same mode and not forced', async () => {
        let handler: any;
        apiPort.onSetMode.mockImplementation((cb: any) => handler = cb);

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
    // ACTION BUTTON
    // ------------------------

    test('action press cycles preset in internet_radio mode', async () => {
        let handler: any;
        inputPort.onActionPress.mockImplementation((cb: any) => handler = cb);

        controller.init();

        await handler();

        expect(state.preset).toBe(2);
        expect(outputPort.setPresetState).toHaveBeenCalledWith(2);
        expect(audioPort.playMode).toHaveBeenCalledWith("internet_radio", 2);
    });

    test('action press wraps around to first preset', async () => {
        state.preset = 4;
        let handler: any;
        inputPort.onActionPress.mockImplementation((cb: any) => handler = cb);

        controller.init();

        await handler();

        expect(state.preset).toBe(0);
    });

    test('action press triggers pairing in bluetooth mode', async () => {
        state.mode = "bluetooth";
        let handler: any;
        inputPort.onActionPress.mockImplementation((cb: any) => handler = cb);

        controller.init();

        await handler();

        expect(state.pairing).toBe(true);
        expect(outputPort.setPairingState).toHaveBeenCalledWith(true);
        expect(audioPort.enablePairing).toHaveBeenCalled();
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
    // MUTE
    // ------------------------

    test('encoder press mutes via input and flashes MUTED on display', async () => {
        let handler: any;
        inputPort.onVolumeMute.mockImplementation((cb: any) => handler = cb);

        controller.init();

        await handler();

        expect(state.muted).toBe(true);
        expect(audioPort.setVolume).toHaveBeenCalledWith(0);
        expect(displayPort.showLines).toHaveBeenCalledWith('http://example.com/station', 'MUTED', { blink: true });
    });

    test('second encoder press unmutes and restores volume', async () => {
        let handler: any;
        inputPort.onVolumeMute.mockImplementation((cb: any) => handler = cb);

        controller.init();

        await handler();
        await handler();

        expect(state.muted).toBe(false);
        expect(audioPort.setVolume).toHaveBeenLastCalledWith(50);
    });

    test('turning the volume knob while muted unmutes and applies the new volume', async () => {
        state.muted = true;
        let volumeHandler: any;
        inputPort.onVolumeChange.mockImplementation((cb: any) => volumeHandler = cb);

        controller.init();

        await volumeHandler(10);

        expect(state.volume).toBe(60);
        expect(state.muted).toBe(false);
        expect(audioPort.setVolume).toHaveBeenCalledWith(60);
    });

    test('api setVolume while muted also unmutes', async () => {
        state.muted = true;
        let handler: any;
        apiPort.onSetVolume.mockImplementation((cb: any) => handler = cb);

        controller.init();

        await handler(70);

        expect(state.muted).toBe(false);
        expect(audioPort.setVolume).toHaveBeenCalledWith(70);
    });

    test('api setMute works', async () => {
        let handler: any;
        apiPort.onSetMute.mockImplementation((cb: any) => handler = cb);

        controller.init();

        await handler(true);

        expect(state.muted).toBe(true);
        expect(audioPort.setVolume).toHaveBeenCalledWith(0);
    });

    // ------------------------
    // NOW PLAYING
    // ------------------------

    test('updates nowPlaying and refreshes display on now-playing change', () => {
        let handler: any;
        audioPort.onNowPlayingChanged.mockImplementation((cb: any) => handler = cb);

        controller.init();

        handler({ title: "Some Song" });

        expect(state.nowPlaying).toEqual({ title: "Some Song" });
        expect(displayPort.showLines).toHaveBeenCalledWith('http://example.com/station', 'Some Song');
    });

    // ------------------------
    // CONNECTION (Bluetooth)
    // ------------------------

    test('device connecting clears pairing state and marks state as connected', () => {
        state.mode = "bluetooth";
        state.pairing = true;
        let handler: any;
        audioPort.onConnectionChanged.mockImplementation((cb: any) => handler = cb);

        controller.init();

        handler(true);

        expect(state.connected).toBe(true);
        expect(state.pairing).toBe(false);
        expect(outputPort.setPairingState).toHaveBeenCalledWith(false);
        expect(displayPort.showLines).toHaveBeenCalledWith('Paired', undefined);
    });

    test('device disconnecting marks state as not connected', () => {
        state.mode = "bluetooth";
        state.connected = true;
        let handler: any;
        audioPort.onConnectionChanged.mockImplementation((cb: any) => handler = cb);

        controller.init();

        handler(false);

        expect(state.connected).toBe(false);
        expect(displayPort.showLines).toHaveBeenCalledWith('Bluetooth', 'Not Paired');
    });

    test('switching modes resets connected state', async () => {
        state.mode = "bluetooth";
        state.connected = true;
        let handler: any;
        apiPort.onSetMode.mockImplementation((cb: any) => handler = cb);

        controller.init();

        await handler("internet_radio");

        expect(state.connected).toBe(false);
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

    test('api setMode works', async () => {
        let handler: any;
        apiPort.onSetMode.mockImplementation((cb: any) => handler = cb);

        controller.init();

        await handler("bluetooth");

        expect(state.mode).toBe("bluetooth");
        expect(audioPort.playMode).toHaveBeenCalledWith("bluetooth", 0);
    });

    test('api setPreset works', async () => {
        let handler: any;
        apiPort.onSetPreset.mockImplementation((cb: any) => handler = cb);

        controller.init();

        await handler(3);

        expect(state.preset).toBe(3);
        expect(audioPort.playMode).toHaveBeenCalledWith("internet_radio", 3);
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
