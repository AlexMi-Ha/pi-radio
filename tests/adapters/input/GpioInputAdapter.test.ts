import { GpioInputAdapter } from "../../../src/adapters/input/GpioInputAdapter";

type MockGpioInstance = {
    pin: number;
    direction: string;
    edge?: string;
    options?: any;
    watch: jest.Mock;
    unwatch: jest.Mock;
    unwatchAll: jest.Mock;
    unexport: jest.Mock;
    readSync: jest.Mock;
    _value: 0 | 1;
};

const instances: MockGpioInstance[] = [];

jest.mock("onoff", () => {
    return {
        Gpio: jest.fn().mockImplementation((pin: number, direction: string, edge?: string, options?: any) => {
            const instance: MockGpioInstance = {
                pin,
                direction,
                edge,
                options,
                watch: jest.fn(),
                unwatch: jest.fn(),
                unwatchAll: jest.fn(),
                unexport: jest.fn(),
                readSync: jest.fn(() => instance._value),
                _value: 0,
            };
            instances.push(instance);
            return instance;
        }),
    };
});

describe("GpioInputAdapter", () => {
    let adapter: GpioInputAdapter;
    let powerBtn: MockGpioInstance;
    let modeBtn: MockGpioInstance;
    let actionBtn: MockGpioInstance;
    let encoderA: MockGpioInstance;
    let encoderB: MockGpioInstance;

    beforeEach(() => {
        instances.length = 0;
        adapter = new GpioInputAdapter({
            powerButtonPin: 17,
            modeButtonPin: 27,
            actionButtonPin: 22,
            encoderAPin: 23,
            encoderBPin: 24,
        });

        [powerBtn, modeBtn, actionBtn, encoderA, encoderB] = instances;
        adapter.start();
    });

    test("constructs buttons as active-low falling-edge inputs with debounce", () => {
        expect(powerBtn.pin).toBe(17);
        expect(powerBtn.edge).toBe("falling");
        expect(powerBtn.options).toMatchObject({ activeLow: true, debounceTimeout: 25 });

        expect(modeBtn.pin).toBe(27);
        expect(actionBtn.pin).toBe(22);
    });

    test("constructs encoder pins with both-edge detection and no debounce option", () => {
        expect(encoderA.pin).toBe(23);
        expect(encoderA.edge).toBe("both");
        expect(encoderA.options).toBeUndefined();
        expect(encoderB.pin).toBe(24);
    });

    test("power button press fires onPowerToggle callback", () => {
        const cb = jest.fn();
        adapter.onPowerToggle(cb);

        const watchCallback = powerBtn.watch.mock.calls[0][0];
        watchCallback(null);

        expect(cb).toHaveBeenCalledTimes(1);
    });

    test("mode button press fires onModeToggle callback", () => {
        const cb = jest.fn();
        adapter.onModeToggle(cb);

        const watchCallback = modeBtn.watch.mock.calls[0][0];
        watchCallback(null);

        expect(cb).toHaveBeenCalledTimes(1);
    });

    test("action button press fires onActionPress callback", () => {
        const cb = jest.fn();
        adapter.onActionPress(cb);

        const watchCallback = actionBtn.watch.mock.calls[0][0];
        watchCallback(null);

        expect(cb).toHaveBeenCalledTimes(1);
    });

    test("button watch error does not fire callback", () => {
        const cb = jest.fn();
        adapter.onPowerToggle(cb);

        const watchCallback = powerBtn.watch.mock.calls[0][0];
        watchCallback(new Error("boom"));

        expect(cb).not.toHaveBeenCalled();
    });

    // A full clockwise quadrature sequence (Gray code 00 -> 01 -> 11 -> 10 -> 00)
    // should report exactly one +1 detent via the volume callback.
    test("clockwise quadrature sequence produces a single positive volume delta", () => {
        const cb = jest.fn();
        adapter.onVolumeChange(cb);

        const encoderCallback = encoderA.watch.mock.calls[0][0];
        const sequence: Array<[0 | 1, 0 | 1]> = [
            [0, 1],
            [1, 1],
            [1, 0],
            [0, 0],
        ];

        for (const [a, b] of sequence) {
            encoderA._value = a;
            encoderB._value = b;
            encoderCallback(null);
        }

        expect(cb).toHaveBeenCalledTimes(1);
        expect(cb).toHaveBeenCalledWith(1);
    });

    test("counter-clockwise quadrature sequence produces a single negative volume delta", () => {
        const cb = jest.fn();
        adapter.onVolumeChange(cb);

        const encoderCallback = encoderB.watch.mock.calls[0][0];
        const sequence: Array<[0 | 1, 0 | 1]> = [
            [1, 0],
            [1, 1],
            [0, 1],
            [0, 0],
        ];

        for (const [a, b] of sequence) {
            encoderA._value = a;
            encoderB._value = b;
            encoderCallback(null);
        }

        expect(cb).toHaveBeenCalledTimes(1);
        expect(cb).toHaveBeenCalledWith(-1);
    });

    test("bouncy/illegal transitions do not produce spurious volume callbacks", () => {
        const cb = jest.fn();
        adapter.onVolumeChange(cb);

        const encoderCallback = encoderA.watch.mock.calls[0][0];
        // Jump straight from 00 to 11 - not a legal single-step quadrature
        // transition - should be rejected by the FSM rather than counted.
        encoderA._value = 1;
        encoderB._value = 1;
        encoderCallback(null);

        expect(cb).not.toHaveBeenCalled();
    });

    test("custom volumeStepPerDetent scales the emitted delta", () => {
        instances.length = 0;
        const customAdapter = new GpioInputAdapter({
            powerButtonPin: 17,
            modeButtonPin: 27,
            actionButtonPin: 22,
            encoderAPin: 23,
            encoderBPin: 24,
            volumeStepPerDetent: 5,
        });
        const [, , , eA, eB] = instances;
        customAdapter.start();

        const cb = jest.fn();
        customAdapter.onVolumeChange(cb);

        const encoderCallback = eA.watch.mock.calls[0][0];
        const sequence: Array<[0 | 1, 0 | 1]> = [
            [0, 1],
            [1, 1],
            [1, 0],
            [0, 0],
        ];
        for (const [a, b] of sequence) {
            eA._value = a;
            eB._value = b;
            encoderCallback(null);
        }

        expect(cb).toHaveBeenCalledWith(5);
    });

    test("stop unwatches and unexports all gpio lines", () => {
        adapter.stop();

        for (const instance of [powerBtn, modeBtn, actionBtn, encoderA, encoderB]) {
            expect(instance.unwatchAll).toHaveBeenCalledTimes(1);
            expect(instance.unexport).toHaveBeenCalledTimes(1);
        }
    });
});
