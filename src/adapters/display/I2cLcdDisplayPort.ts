import i2c, { I2CBus } from "i2c-bus";
import { DisplayPort } from "../../core/ports/DisplayPort";
import { logger } from "../../core/util/Logger";

// PCF8574 I2C LCD backpack bit layout (the ubiquitous "LiquidCrystal_I2C"
// wiring): P0=RS, P1=RW (unused, always 0), P2=EN, P3=backlight, P4-P7=data
// nibble (4-bit HD44780 mode).
const RS_BIT = 0x01;
const EN_BIT = 0x04;
const BACKLIGHT_BIT = 0x08;

const LCD_CLEAR_DISPLAY = 0x01;
const LCD_ENTRY_MODE_SET = 0x06;
const LCD_DISPLAY_ON = 0x0c;
const LCD_FUNCTION_SET_4BIT_2LINE = 0x28;
const LCD_SET_DDRAM_ADDR = 0x80;

const LINE_WIDTH = 16;
const LINE2_DDRAM_OFFSET = 0x40;

function sleepMs(ms: number): void {
    const end = Date.now() + ms;
    while (Date.now() < end) {
        // busy-wait: the i2c-bus sync calls used by this driver already
        // block the event loop, so this adds no additional concern during
        // the brief init sequence and enable-pulse timing.
    }
}

export interface I2cLcdDisplayPortOptions {
    busNumber?: number;
    address?: number;
    scrollIntervalMs?: number;
    blinkIntervalMs?: number;
}

export class I2cLcdDisplayPort implements DisplayPort {
    private bus: I2CBus;
    private readonly address: number;
    private readonly scrollIntervalMs: number;
    private readonly blinkIntervalMs: number;

    private persistentLine1 = "";
    private persistentLine2 = "";
    private persistentOptions: { blink?: boolean } = {};

    private scrollOffset = 0;
    private scrollTimer: NodeJS.Timeout | undefined = undefined;
    private blinkTimer: NodeJS.Timeout | undefined = undefined;
    private blinkOn = true;
    private transientTimer: NodeJS.Timeout | undefined = undefined;

    // Tracks whether the last I2C write failed, so repeated failures (e.g. a loose
    // connector causing every single char write to fail) log once instead of flooding
    // the log - only the fail->ok and ok->fail transitions are logged.
    private i2cErrored = false;

    constructor(options: I2cLcdDisplayPortOptions = {}) {
        this.address = options.address ?? 0x27;
        this.scrollIntervalMs = options.scrollIntervalMs ?? 400;
        this.blinkIntervalMs = options.blinkIntervalMs ?? 500;
        this.bus = i2c.openSync(options.busNumber ?? 1);
        this.init();
    }

    private writeByte(data: number): void {
        const buf = Buffer.from([data | BACKLIGHT_BIT]);
        try {
            this.bus.i2cWriteSync(this.address, buf.length, buf);
            if (this.i2cErrored) {
                this.i2cErrored = false;
                logger.log("[LCD] I2C write recovered");
            }
        } catch (err) {
            // Swallow: a flaky display connection must not take down the whole radio
            // process. Only log the first failure of a run, to avoid flooding the log
            // since this is called on every character write.
            if (!this.i2cErrored) {
                this.i2cErrored = true;
                logger.error("[LCD] I2C write failed, display output may be stuck:", err);
            }
        }
    }

    private pulseEnable(data: number): void {
        this.writeByte(data | EN_BIT);
        sleepMs(1);
        this.writeByte(data & ~EN_BIT);
        sleepMs(1);
    }

    private write4Bits(nibble: number): void {
        this.pulseEnable(nibble);
    }

    private send(value: number, rsBit: number): void {
        const highNibble = (value & 0xf0) | rsBit;
        const lowNibble = ((value << 4) & 0xf0) | rsBit;
        this.write4Bits(highNibble);
        this.write4Bits(lowNibble);
    }

    private command(value: number): void {
        this.send(value, 0);
    }

    private writeChar(value: number): void {
        this.send(value, RS_BIT);
    }

    private init(): void {
        sleepMs(50);

        // HD44780 4-bit mode init sequence (datasheet-mandated retries).
        this.write4Bits(0x30);
        sleepMs(5);
        this.write4Bits(0x30);
        sleepMs(1);
        this.write4Bits(0x30);
        sleepMs(1);
        this.write4Bits(0x20);
        sleepMs(1);

        this.command(LCD_FUNCTION_SET_4BIT_2LINE);
        this.command(LCD_DISPLAY_ON);
        this.command(LCD_CLEAR_DISPLAY);
        sleepMs(2);
        this.command(LCD_ENTRY_MODE_SET);
    }

    private setCursor(col: number, row: number): void {
        const rowOffset = row === 0 ? 0 : LINE2_DDRAM_OFFSET;
        this.command(LCD_SET_DDRAM_ADDR | (rowOffset + col));
    }

    private renderLine(row: number, text: string): void {
        this.setCursor(0, row);
        const padded = text.slice(0, LINE_WIDTH).padEnd(LINE_WIDTH, " ");
        for (const ch of padded) {
            this.writeChar(ch.charCodeAt(0));
        }
    }

    private renderRaw(line1: string, line2: string): void {
        this.renderLine(0, line1);
        this.renderLine(1, line2);
    }

    private clearTimers(): void {
        if (this.scrollTimer) {
            clearInterval(this.scrollTimer);
            this.scrollTimer = undefined;
        }
        if (this.blinkTimer) {
            clearInterval(this.blinkTimer);
            this.blinkTimer = undefined;
        }
    }

    private renderPersistent(): void {
        if (this.blinkOn) {
            this.renderRaw(this.scrolledWindow(this.persistentLine1), this.scrolledWindow(this.persistentLine2));
        } else {
            this.renderRaw("", "");
        }
    }

    private scrolledWindow(text: string): string {
        if (text.length <= LINE_WIDTH) return text;
        // Loop with a one-blank-space gap between repetitions.
        const looped = text + "   " + text;
        const offset = this.scrollOffset % (text.length + 3);
        return looped.slice(offset, offset + LINE_WIDTH);
    }

    private startPersistentTimers(): void {
        this.clearTimers();

        const needsScroll =
            this.persistentLine1.length > LINE_WIDTH || this.persistentLine2.length > LINE_WIDTH;
        if (needsScroll) {
            this.scrollOffset = 0;
            this.scrollTimer = setInterval(() => {
                this.scrollOffset++;
                this.renderPersistent();
            }, this.scrollIntervalMs);
        }

        if (this.persistentOptions.blink) {
            this.blinkOn = true;
            this.blinkTimer = setInterval(() => {
                this.blinkOn = !this.blinkOn;
                this.renderPersistent();
            }, this.blinkIntervalMs);
        } else {
            this.blinkOn = true;
        }
    }

    showLines(line1: string, line2?: string, options?: { blink?: boolean }): void {
        if (this.transientTimer) {
            clearTimeout(this.transientTimer);
            this.transientTimer = undefined;
        }

        this.persistentLine1 = line1;
        this.persistentLine2 = line2 ?? "";
        this.persistentOptions = options ?? {};
        this.scrollOffset = 0;

        this.startPersistentTimers();
        this.renderPersistent();
    }

    showTransient(line1: string, line2?: string, durationMs: number = 2000): void {
        this.clearTimers();
        if (this.transientTimer) {
            clearTimeout(this.transientTimer);
        }

        this.renderRaw(line1, line2 ?? "");

        this.transientTimer = setTimeout(() => {
            this.transientTimer = undefined;
            this.startPersistentTimers();
            this.renderPersistent();
        }, durationMs);
    }

    stop(): void {
        this.clearTimers();
        if (this.transientTimer) {
            clearTimeout(this.transientTimer);
            this.transientTimer = undefined;
        }
        try {
            this.bus.closeSync();
        } catch (err) {
            logger.error("[LCD] Failed to close I2C bus:", err);
        }
    }
}
