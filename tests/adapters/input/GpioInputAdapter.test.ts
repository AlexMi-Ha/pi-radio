import { EventEmitter } from "events";
import { Readable } from "stream";
import { GpioInputAdapter } from "../../../src/adapters/input/GpioInputAdapter";

type MockProc = EventEmitter & {
    stdout: Readable;
    stderr: EventEmitter;
    kill: jest.Mock;
    args: string[];
};

const spawnedProcs: MockProc[] = [];

jest.mock("child_process", () => ({
    spawn: jest.fn((_cmd: string, args: string[]) => {
        const proc = new EventEmitter() as MockProc;
        proc.stdout = new Readable({ read() {} });
        proc.stderr = new EventEmitter();
        proc.kill = jest.fn();
        proc.args = args;
        spawnedProcs.push(proc);
        return proc;
    }),
}));

function emitLine(proc: MockProc, line: string): void {
    proc.stdout.push(`${line}\n`);
}

describe("GpioInputAdapter", () => {
    let adapter: GpioInputAdapter;
    let buttonProc: MockProc;
    let encoderProc: MockProc;

    beforeEach(() => {
        spawnedProcs.length = 0;
        adapter = new GpioInputAdapter({
            powerButtonPin: 17,
            modeButtonPin: 27,
            actionButtonPin: 22,
            encoderAPin: 23,
            encoderBPin: 24,
            encoderButtonPin: 25,
        });
        adapter.start();

        [buttonProc, encoderProc] = spawnedProcs;
    });

    test("spawns gpiomon for the buttons with falling-edge detection and debounce", () => {
        expect(buttonProc.args).toEqual(
            expect.arrayContaining(["--edges", "falling", "--debounce-period", "25", "17", "27", "22", "25"])
        );
    });

    test("spawns gpiomon for the encoder pins with both-edge detection and no debounce", () => {
        expect(encoderProc.args).toEqual(expect.arrayContaining(["--edges", "both", "23", "24"]));
        expect(encoderProc.args).not.toContain("--debounce-period");
    });

    test("power button press fires onPowerToggle callback", (done) => {
        const cb = jest.fn();
        adapter.onPowerToggle(cb);

        emitLine(buttonProc, "17");
        setImmediate(() => {
            expect(cb).toHaveBeenCalledTimes(1);
            done();
        });
    });

    test("mode button press fires onModeToggle callback", (done) => {
        const cb = jest.fn();
        adapter.onModeToggle(cb);

        emitLine(buttonProc, "27");
        setImmediate(() => {
            expect(cb).toHaveBeenCalledTimes(1);
            done();
        });
    });

    test("action button press fires onActionPress callback", (done) => {
        const cb = jest.fn();
        adapter.onActionPress(cb);

        emitLine(buttonProc, "22");
        setImmediate(() => {
            expect(cb).toHaveBeenCalledTimes(1);
            done();
        });
    });

    test("encoder button press fires onVolumeMute callback", (done) => {
        const cb = jest.fn();
        adapter.onVolumeMute(cb);

        emitLine(buttonProc, "25");
        setImmediate(() => {
            expect(cb).toHaveBeenCalledTimes(1);
            done();
        });
    });

    // A full clockwise quadrature sequence (Gray code 00 -> 01 -> 11 -> 10 -> 00)
    // should report exactly one -1 detent via the volume callback (volume
    // direction is intentionally inverted: clockwise turns the volume down).
    test("clockwise quadrature sequence produces a single negative volume delta", (done) => {
        const cb = jest.fn();
        adapter.onVolumeChange(cb);

        // (pin, edgeCode) pairs: edgeCode 1 = rising, 2 = falling.
        const events: Array<[number, number]> = [
            [24, 1], // B rises: 00 -> 01
            [23, 1], // A rises: 01 -> 11
            [24, 2], // B falls: 11 -> 10
            [23, 2], // A falls: 10 -> 00
        ];

        for (const [pin, edge] of events) {
            emitLine(encoderProc, `${pin} ${edge}`);
        }

        setImmediate(() => {
            expect(cb).toHaveBeenCalledTimes(1);
            expect(cb).toHaveBeenCalledWith(-6);
            done();
        });
    });

    test("counter-clockwise quadrature sequence produces a single positive volume delta", (done) => {
        const cb = jest.fn();
        adapter.onVolumeChange(cb);

        const events: Array<[number, number]> = [
            [23, 1], // A rises: 00 -> 10
            [24, 1], // B rises: 10 -> 11
            [23, 2], // A falls: 11 -> 01
            [24, 2], // B falls: 01 -> 00
        ];

        for (const [pin, edge] of events) {
            emitLine(encoderProc, `${pin} ${edge}`);
        }

        setImmediate(() => {
            expect(cb).toHaveBeenCalledTimes(1);
            expect(cb).toHaveBeenCalledWith(6);
            done();
        });
    });

    test("bouncy/illegal transitions do not produce spurious volume callbacks", (done) => {
        const cb = jest.fn();
        adapter.onVolumeChange(cb);

        // Jump straight from 00 to 11 - not a legal single-step quadrature
        // transition - should be rejected by the FSM rather than counted.
        emitLine(encoderProc, "23 1");
        emitLine(encoderProc, "24 1");

        setImmediate(() => {
            expect(cb).not.toHaveBeenCalled();
            done();
        });
    });

    test("custom volumeStepPerDetent scales the emitted delta", (done) => {
        spawnedProcs.length = 0;
        const customAdapter = new GpioInputAdapter({
            powerButtonPin: 17,
            modeButtonPin: 27,
            actionButtonPin: 22,
            encoderAPin: 23,
            encoderBPin: 24,
            encoderButtonPin: 25,
            volumeStepPerDetent: 5,
        });
        customAdapter.start();
        const [, customEncoderProc] = spawnedProcs;

        const cb = jest.fn();
        customAdapter.onVolumeChange(cb);

        const events: Array<[number, number]> = [
            [24, 1],
            [23, 1],
            [24, 2],
            [23, 2],
        ];
        for (const [pin, edge] of events) {
            emitLine(customEncoderProc, `${pin} ${edge}`);
        }

        setImmediate(() => {
            expect(cb).toHaveBeenCalledWith(-5);
            done();
        });
    });

    test("stop kills both gpiomon processes", () => {
        adapter.stop();

        expect(buttonProc.kill).toHaveBeenCalledTimes(1);
        expect(encoderProc.kill).toHaveBeenCalledTimes(1);
    });
});
