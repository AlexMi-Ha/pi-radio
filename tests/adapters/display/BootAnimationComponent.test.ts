import { BootAnimationComponent } from "../../../src/adapters/display/BootAnimationComponent";
import { buildBootAnimationFrames } from "../../../src/adapters/display/BootAnimationFrames";

describe("BootAnimationComponent", () => {

    let render: jest.Mock;
    let animation: BootAnimationComponent;
    const totalFrames = buildBootAnimationFrames().length;

    beforeEach(() => {
        render = jest.fn();
        animation = new BootAnimationComponent(render);
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    test("renders the first frame immediately", () => {
        jest.useFakeTimers();
        const onDone = jest.fn();

        animation.play(onDone, 10);

        expect(render).toHaveBeenCalledTimes(1);
        expect(onDone).not.toHaveBeenCalled();
    });

    test("renders every frame once, then calls onDone exactly once", () => {
        jest.useFakeTimers();
        const onDone = jest.fn();

        animation.play(onDone, 10);
        jest.advanceTimersByTime(10 * totalFrames);

        expect(render).toHaveBeenCalledTimes(totalFrames);
        expect(onDone).toHaveBeenCalledTimes(1);

        render.mockClear();
        jest.advanceTimersByTime(1000);
        expect(render).not.toHaveBeenCalled();
        expect(onDone).toHaveBeenCalledTimes(1);
    });

    test("stop() cancels playback before completion without calling onDone", () => {
        jest.useFakeTimers();
        const onDone = jest.fn();

        animation.play(onDone, 10);
        jest.advanceTimersByTime(30);
        animation.stop();

        render.mockClear();
        jest.advanceTimersByTime(10 * totalFrames);

        expect(render).not.toHaveBeenCalled();
        expect(onDone).not.toHaveBeenCalled();
    });
});
