import { ClockDisplayComponent } from "../../../src/adapters/display/ClockDisplayComponent";

describe("ClockDisplayComponent", () => {

    let render: jest.Mock;
    let clock: ClockDisplayComponent;

    beforeEach(() => {
        render = jest.fn();
        clock = new ClockDisplayComponent(render);
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    test("is inactive until showClock() is called", () => {
        expect(clock.isActive).toBe(false);
        expect(render).not.toHaveBeenCalled();
    });

    test("showClock() renders immediately and becomes active", () => {
        jest.useFakeTimers().setSystemTime(new Date(2026, 10, 27, 14, 5, 0));

        clock.showClock();

        expect(clock.isActive).toBe(true);
        expect(render).toHaveBeenCalledWith("14:05", "Freitag 27/11/2026");
    });

    test("ticks once per minute, aligned to the minute boundary", () => {
        jest.useFakeTimers().setSystemTime(new Date(2026, 10, 27, 14, 5, 30));

        clock.showClock();
        render.mockClear();

        jest.advanceTimersByTime(29999);
        expect(render).not.toHaveBeenCalled();

        jest.advanceTimersByTime(1);
        expect(render).toHaveBeenCalledWith("14:06", "Freitag 27/11/2026");
    });

    test("hideClock() stops ticking and marks it inactive", () => {
        jest.useFakeTimers().setSystemTime(new Date(2026, 10, 27, 14, 5, 0));

        clock.showClock();
        clock.hideClock();

        expect(clock.isActive).toBe(false);

        render.mockClear();
        jest.advanceTimersByTime(5 * 60000);
        expect(render).not.toHaveBeenCalled();
    });

    test("showClock() after hideClock() resumes ticking", () => {
        jest.useFakeTimers().setSystemTime(new Date(2026, 10, 27, 14, 5, 0));

        clock.showClock();
        clock.hideClock();
        render.mockClear();

        clock.showClock();
        expect(render).toHaveBeenCalledWith("14:05", "Freitag 27/11/2026");

        render.mockClear();
        jest.advanceTimersByTime(60000);
        expect(render).toHaveBeenCalledWith("14:06", "Freitag 27/11/2026");
    });
});
