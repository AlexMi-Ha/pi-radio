import { MockDisplayPort } from "../../../src/adapters/display/MockDisplayPort";
import { buildBootAnimationFrames } from "../../../src/adapters/display/BootAnimationFrames";
import { logger } from "../../../src/core/util/Logger";

describe("MockDisplayPort", () => {

    let display: MockDisplayPort;
    let logSpy: jest.SpyInstance;
    const totalFrames = buildBootAnimationFrames().length;

    beforeEach(() => {
        display = new MockDisplayPort();
        logSpy = jest.spyOn(logger, "log").mockImplementation(() => {});
    });

    afterEach(() => {
        logSpy.mockRestore();
        jest.useRealTimers();
    });

    test("playBootAnimation runs every frame then calls onDone", () => {
        jest.useFakeTimers();
        const onDone = jest.fn();
        logSpy.mockClear();

        display.playBootAnimation(onDone);
        jest.advanceTimersByTime(70 * totalFrames);

        expect(onDone).toHaveBeenCalledTimes(1);
        expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Hello"));
    });

    test("clear() stops a running boot animation and logs that it cleared", () => {
        jest.useFakeTimers();
        display.playBootAnimation(jest.fn());

        display.clear();
        logSpy.mockClear();

        jest.advanceTimersByTime(10 * 1000);
        expect(logSpy).not.toHaveBeenCalled();
    });

    test("setPower(false) shows a clock; clear() silences it too", () => {
        jest.useFakeTimers().setSystemTime(new Date(2026, 10, 27, 14, 5, 0));

        display.setPower(false);
        display.clear();
        logSpy.mockClear();

        jest.advanceTimersByTime(5 * 60000);

        expect(logSpy).not.toHaveBeenCalled();
    });
});
