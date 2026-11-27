import { AipI2cLcdDisplayPort } from "../../../src/adapters/display/AipI2cLcdDisplayPort";

const CONTROL_COMMAND = 0x00;
const CONTROL_DATA = 0x40;
const LCD_DISPLAY_ON = 0x0c;
const LCD_DISPLAY_OFF = 0x08;
const DAY_NAMES = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];

let i2cWriteSync: jest.Mock;
let closeSync: jest.Mock;

jest.mock("i2c-bus", () => {
    return {
        openSync: jest.fn(() => ({
            i2cWriteSync: jest.fn(),
            closeSync: jest.fn(),
        })),
    };
});

// Decodes the raw AiP31068L bus traffic this adapter emits: each call is one
// I2C transaction [control byte][payload byte(s)] - no nibble splitting, no
// Enable-pin pulsing (unlike the PCF8574 backpack driver's protocol).
function decodeWrites(calls: number[][]): Array<{ control: number; payload: number[] }> {
    return calls.map((bytes) => ({ control: bytes[0]!, payload: bytes.slice(1) }));
}

function decodeCharWrites(calls: number[][]): string {
    return decodeWrites(calls)
        .filter((d) => d.control === CONTROL_DATA)
        .map((d) => d.payload.map((b) => String.fromCharCode(b)).join(""))
        .join("");
}

function rawCalls(mock: jest.Mock): number[][] {
    return mock.mock.calls.map((c: any[]) => Array.from(c[2] as Buffer));
}

function line(text: string): string {
    return text.slice(0, 16).padEnd(16, " ");
}

describe("AipI2cLcdDisplayPort", () => {
    let display: AipI2cLcdDisplayPort;

    beforeEach(() => {
        const i2c = require("i2c-bus");
        (i2c.openSync as jest.Mock).mockClear();
        display = new AipI2cLcdDisplayPort({ scrollIntervalMs: 20, blinkIntervalMs: 20 });

        const busInstance = (i2c.openSync as jest.Mock).mock.results[0]!.value;
        i2cWriteSync = busInstance.i2cWriteSync;
        closeSync = busInstance.closeSync;
    });

    afterEach(() => {
        // Ensures fake timers from a mid-test assertion failure don't leak
        // into the next test's beforeEach, where the real-time busy-wait in
        // the constructor's init() would spin forever against a frozen clock.
        jest.useRealTimers();
        display.stop();
    });

    test("opens the configured i2c bus and address", () => {
        const i2c = require("i2c-bus");
        display.stop();
        (i2c.openSync as jest.Mock).mockClear();

        const custom = new AipI2cLcdDisplayPort({ busNumber: 3, address: 0x3e });
        expect(i2c.openSync).toHaveBeenCalledWith(3);
        custom.stop();
    });

    test("showLines writes the given text, padded to 16 chars, to both lines", () => {
        i2cWriteSync.mockClear();
        display.showLines("Hello", "World");

        const text = decodeCharWrites(rawCalls(i2cWriteSync));
        expect(text).toBe("Hello           World           ");
    });

    test("showLines handles a missing second line as blank", () => {
        i2cWriteSync.mockClear();
        display.showLines("OnlyLine1");

        const text = decodeCharWrites(rawCalls(i2cWriteSync));
        expect(text).toBe("OnlyLine1       " + " ".repeat(16));
    });

    test("showTransient immediately overlays, then reverts to prior showLines content after durationMs", async () => {
        display.showLines("Persistent", "Content");
        i2cWriteSync.mockClear();

        display.showTransient("Temp", "Msg", 20);

        const transientText = decodeCharWrites(rawCalls(i2cWriteSync));
        expect(transientText).toBe("Temp            " + "Msg             ");

        i2cWriteSync.mockClear();
        await new Promise((resolve) => setTimeout(resolve, 60));

        const revertedText = decodeCharWrites(rawCalls(i2cWriteSync));
        expect(revertedText).toContain("Persistent");
        expect(revertedText).toContain("Content");
    });

    test("blink option periodically clears and redraws the persistent content", async () => {
        display.showLines("Pairing", "Phone", { blink: true });
        i2cWriteSync.mockClear();

        await new Promise((resolve) => setTimeout(resolve, 70));

        const fullText = decodeCharWrites(rawCalls(i2cWriteSync));
        // Blinking toggles between the rendered text and a blanked line, so
        // over several intervals we should see both blank stretches and the
        // original text reappear.
        expect(fullText).toContain("Pairing");
        expect(fullText).toMatch(/ {16}/);
    });

    test("stop closes the i2c bus", () => {
        display.stop();
        expect(closeSync).toHaveBeenCalledTimes(1);
    });

    test("setPower(false) shows a clock instead of sending Display OFF, and stops rendering normal content", () => {
        jest.useFakeTimers().setSystemTime(new Date(2026, 10, 27, 14, 5, 0));

        display.showLines("Hello", "World");
        i2cWriteSync.mockClear();

        display.setPower(false);

        const calls = rawCalls(i2cWriteSync);
        expect(calls).not.toContainEqual([CONTROL_COMMAND, LCD_DISPLAY_OFF]);
        const text = decodeCharWrites(calls);
        expect(text).toBe(line("14:05") + line(`${DAY_NAMES[5]} 27/11/2026`));

        i2cWriteSync.mockClear();
        display.showLines("Should", "NotRender");
        expect(i2cWriteSync).not.toHaveBeenCalled();
    });

    test("the clock ticks once per minute while idle", () => {
        jest.useFakeTimers().setSystemTime(new Date(2026, 10, 27, 14, 5, 30));

        display.setPower(false);
        i2cWriteSync.mockClear();

        jest.advanceTimersByTime(30000);

        const text = decodeCharWrites(rawCalls(i2cWriteSync));
        expect(text).toBe(line("14:06") + line(`${DAY_NAMES[5]} 27/11/2026`));
    });

    test("setPower(true) sends Display ON, stops the clock and re-renders the last persistent content", () => {
        jest.useFakeTimers().setSystemTime(new Date(2026, 10, 27, 14, 5, 0));

        display.showLines("Hello", "World");
        display.setPower(false);
        i2cWriteSync.mockClear();

        display.setPower(true);

        const calls = rawCalls(i2cWriteSync);
        expect(calls).toContainEqual([CONTROL_COMMAND, LCD_DISPLAY_ON]);

        const text = decodeCharWrites(calls);
        expect(text).toBe("Hello           World           ");

        i2cWriteSync.mockClear();
        jest.advanceTimersByTime(5 * 60000);
        expect(i2cWriteSync).not.toHaveBeenCalled();
    });

    test("setPower is a no-op when called with the current power state", () => {
        i2cWriteSync.mockClear();
        display.setPower(true);
        expect(i2cWriteSync).not.toHaveBeenCalled();
    });
});
