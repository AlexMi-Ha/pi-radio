import { I2cLcdDisplayPort } from "../../../src/adapters/display/I2cLcdDisplayPort";

const EN_BIT = 0x04;
const RS_BIT = 0x01;
const BACKLIGHT_BIT = 0x08;

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

// Decodes the raw PCF8574/HD44780 4-bit-mode bus traffic this adapter emits
// back into (rs, byteValue) pairs, so tests can assert on recognizable
// content ("the adapter wrote these characters") instead of raw bytes.
function decodeWrites(calls: number[][]): Array<{ rs: number; value: number }> {
    const enableHighWrites = calls.filter(([data]) => ((data as number) & EN_BIT) !== 0);
    const decoded: Array<{ rs: number; value: number }> = [];

    for (let i = 0; i + 1 < enableHighWrites.length; i += 2) {
        const highNibbleByte = enableHighWrites[i]![0]!;
        const lowNibbleByte = enableHighWrites[i + 1]![0]!;
        const value = ((highNibbleByte >> 4) & 0xf) << 4 | ((lowNibbleByte >> 4) & 0xf);
        const rs = highNibbleByte & RS_BIT;
        decoded.push({ rs, value });
    }
    return decoded;
}

function decodeCharWrites(calls: number[][]): string {
    return decodeWrites(calls)
        .filter((d) => d.rs === RS_BIT)
        .map((d) => String.fromCharCode(d.value))
        .join("");
}

describe("I2cLcdDisplayPort", () => {
    let display: I2cLcdDisplayPort;

    beforeEach(() => {
        const i2c = require("i2c-bus");
        (i2c.openSync as jest.Mock).mockClear();
        display = new I2cLcdDisplayPort({ scrollIntervalMs: 20, blinkIntervalMs: 20 });

        const busInstance = (i2c.openSync as jest.Mock).mock.results[0]!.value;
        i2cWriteSync = busInstance.i2cWriteSync;
        closeSync = busInstance.closeSync;
    });

    afterEach(() => {
        display.stop();
    });

    test("opens the configured i2c bus and address", () => {
        const i2c = require("i2c-bus");
        display.stop();
        (i2c.openSync as jest.Mock).mockClear();

        const custom = new I2cLcdDisplayPort({ busNumber: 3, address: 0x3f });
        expect(i2c.openSync).toHaveBeenCalledWith(3);
        custom.stop();
    });

    test("showLines writes the given text, padded to 16 chars, to both lines", () => {
        i2cWriteSync.mockClear();
        display.showLines("Hello", "World");

        const text = decodeCharWrites(i2cWriteSync.mock.calls.map((c: any[]) => [c[2][0]]));
        expect(text).toBe("Hello           World           ");
    });

    test("showLines handles a missing second line as blank", () => {
        i2cWriteSync.mockClear();
        display.showLines("OnlyLine1");

        const text = decodeCharWrites(i2cWriteSync.mock.calls.map((c: any[]) => [c[2][0]]));
        expect(text).toBe("OnlyLine1       " + " ".repeat(16));
    });

    test("showTransient immediately overlays, then reverts to prior showLines content after durationMs", async () => {
        display.showLines("Persistent", "Content");
        i2cWriteSync.mockClear();

        display.showTransient("Temp", "Msg", 20);

        const transientText = decodeCharWrites(i2cWriteSync.mock.calls.map((c: any[]) => [c[2][0]]));
        expect(transientText).toBe("Temp            " + "Msg             ");

        i2cWriteSync.mockClear();
        await new Promise((resolve) => setTimeout(resolve, 60));

        const revertedText = decodeCharWrites(i2cWriteSync.mock.calls.map((c: any[]) => [c[2][0]]));
        expect(revertedText).toContain("Persistent");
        expect(revertedText).toContain("Content");
    });

    test("blink option periodically clears and redraws the persistent content", async () => {
        display.showLines("Pairing", "Phone", { blink: true });
        i2cWriteSync.mockClear();

        await new Promise((resolve) => setTimeout(resolve, 70));

        const allCalls = i2cWriteSync.mock.calls.map((c: any[]) => [c[2][0]]);
        const fullText = decodeCharWrites(allCalls);
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

    test("setPower(false) turns off the backlight and stops rendering content", () => {
        display.showLines("Hello", "World");
        i2cWriteSync.mockClear();

        display.setPower(false);

        const offWriteBytes = i2cWriteSync.mock.calls.map((c: any[]) => c[2][0] as number);
        expect(offWriteBytes.length).toBeGreaterThan(0);
        expect(offWriteBytes.every((b) => (b & BACKLIGHT_BIT) === 0)).toBe(true);

        i2cWriteSync.mockClear();
        display.showLines("Should", "NotRender");
        expect(i2cWriteSync).not.toHaveBeenCalled();
    });

    test("setPower(true) restores the backlight and re-renders the last persistent content", () => {
        display.showLines("Hello", "World");
        display.setPower(false);
        i2cWriteSync.mockClear();

        display.setPower(true);

        const calls = i2cWriteSync.mock.calls.map((c: any[]) => c[2][0] as number);
        expect(calls.some((b) => (b & BACKLIGHT_BIT) !== 0)).toBe(true);

        const text = decodeCharWrites(calls.map((b) => [b]));
        expect(text).toBe("Hello           World           ");
    });

    test("setPower is a no-op when called with the current power state", () => {
        i2cWriteSync.mockClear();
        display.setPower(true);
        expect(i2cWriteSync).not.toHaveBeenCalled();
    });
});
