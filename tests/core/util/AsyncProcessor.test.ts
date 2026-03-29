import { AsyncProcessor } from "../../../src/core/util/AsyncProcessor"

jest.useFakeTimers();

describe('AsyncProcessor', () => {

    let processor: AsyncProcessor;

    beforeEach(() => {
        processor = new AsyncProcessor();
        jest.clearAllTimers();
        jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('runs task immediately when debounceTime = 0', async () => {
        const fn = jest.fn().mockResolvedValue(undefined);

        processor.runSafe(fn, 0);

        // allow async process loop to run
        await Promise.resolve();

        expect(fn).toHaveBeenCalledTimes(1);
    });

    test('debounces multiple calls and runs only latest task', async () => {
        const fn1 = jest.fn().mockResolvedValue(undefined);
        const fn2 = jest.fn().mockResolvedValue(undefined);

        processor.runSafe(fn1, 50);
        processor.runSafe(fn2, 50);

        // Fast-forward debounce timer
        jest.advanceTimersByTime(50);

        await Promise.resolve();

        expect(fn1).not.toHaveBeenCalled();
        expect(fn2).toHaveBeenCalledTimes(1);
    });

    test('processes tasks sequentially', async () => {
        const order: number[] = [];

        const fn1 = jest.fn(async () => {
            order.push(1);
        });

        const fn2 = jest.fn(async () => {
            order.push(2);
        });

        processor.runSafe(fn1, 0);
        processor.runSafe(fn2, 0);

        await Promise.resolve();
        await Promise.resolve();

        expect(order).toEqual([1, 2]);
    });

    test('does not start a new process loop if already running', async () => {
        let resolveFn: () => void;

        const longTask = jest.fn(() => new Promise<void>(res => {
            resolveFn = res;
        }));

        const nextTask = jest.fn().mockResolvedValue(undefined);

        processor.runSafe(longTask, 0);
        processor.runSafe(nextTask, 0);

        // let first task start
        await Promise.resolve();

        expect(longTask).toHaveBeenCalledTimes(1);
        expect(nextTask).not.toHaveBeenCalled();

        // resolve first task
        resolveFn!();

        await Promise.resolve();
        await Promise.resolve();

        expect(nextTask).toHaveBeenCalledTimes(1);
    });

    test('continues processing even if a task throws', async () => {
        const errorTask = jest.fn().mockRejectedValue(new Error('fail'));
        const goodTask = jest.fn().mockResolvedValue(undefined);

        processor.runSafe(errorTask, 0);
        processor.runSafe(goodTask, 0);

        await Promise.resolve();
        await Promise.resolve();

        expect(errorTask).toHaveBeenCalled();
        expect(goodTask).toHaveBeenCalled();
        expect(console.error).toHaveBeenCalled();
    });

    test('executes latest task added while running', async () => {
        let resolveFn: () => void;

        const firstTask = jest.fn(() => new Promise<void>(res => {
            resolveFn = res;
        }));

        const secondTask = jest.fn().mockResolvedValue(undefined);

        processor.runSafe(firstTask, 0);

        await Promise.resolve();

        // Add new task while first is running
        processor.runSafe(secondTask, 0);

        resolveFn!();

        await Promise.resolve();
        await Promise.resolve();

        expect(firstTask).toHaveBeenCalledTimes(1);
        expect(secondTask).toHaveBeenCalledTimes(1);
    });

    test('debounce resets timer on rapid calls', async () => {
        const fn = jest.fn().mockResolvedValue(undefined);

        processor.runSafe(fn, 100);
        jest.advanceTimersByTime(50);

        processor.runSafe(fn, 100);
        jest.advanceTimersByTime(50);

        // should NOT have run yet
        expect(fn).not.toHaveBeenCalled();

        jest.advanceTimersByTime(50);

        await Promise.resolve();

        expect(fn).toHaveBeenCalledTimes(1);
    });
});