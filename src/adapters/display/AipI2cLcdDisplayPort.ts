import i2c, { I2CBus } from "i2c-bus";
import { DisplayPort } from "../../core/ports/DisplayPort";
import { logger } from "../../core/util/Logger";
import { ClockDisplayComponent } from "./ClockDisplayComponent";

// AiP31068L native-I2C LCD controller (Waveshare LCD1602 I2C Module).
// Every write is a single I2C transaction [control byte][payload...] - no
// nibble splitting, no Enable-pin pulsing like the PCF8574 backpack driver.
// Control byte: bit7 = Co (continuation), bit6 = RS, bits5-0 = 0.
const CONTROL_COMMAND = 0x00; // Co=0, RS=0
const CONTROL_DATA = 0x40; // Co=0, RS=1

const LCD_CLEAR_DISPLAY = 0x01;
const LCD_ENTRY_MODE_SET = 0x06;
const LCD_DISPLAY_ON = 0x0c;
const LCD_FUNCTION_SET_2LINE = 0x28;
const LCD_SET_DDRAM_ADDR = 0x80;

const LINE_WIDTH = 16;
const LINE2_DDRAM_OFFSET = 0x40;

function sleepMs(ms: number): void {
    const end = Date.now() + ms;
    while (Date.now() < end) {
        // busy-wait: the i2c-bus sync calls used by this driver already
        // block the event loop, so this adds no additional concern during
        // the brief init sequence/command timing.
    }
}

export interface AipI2cLcdDisplayPortOptions {
    busNumber?: number;
    address?: number;
    scrollIntervalMs?: number;
    blinkIntervalMs?: number;
}

export class AipI2cLcdDisplayPort implements DisplayPort {
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
    // connector causing every single write to fail) log once instead of flooding
    // the log - only the fail->ok and ok->fail transitions are logged.
    private i2cErrored = false;

    // This module's backlight is hardwired directly to VDD/VSS with no
    // software control, so going "idle" shows a clock instead of sending
    // the HD44780 Display OFF command - that would just leave a blank, lit
    // screen. ClockDisplayComponent owns the clock's own formatting/timer;
    // this adapter only decides when to show/hide it and swallows normal
    // content writes while it's active.
    private clock: ClockDisplayComponent;

    constructor(options: AipI2cLcdDisplayPortOptions = {}) {
        this.address = options.address ?? 0x3e;
        this.scrollIntervalMs = options.scrollIntervalMs ?? 400;
        this.blinkIntervalMs = options.blinkIntervalMs ?? 500;
        this.bus = i2c.openSync(options.busNumber ?? 1);
        this.clock = new ClockDisplayComponent((line1, line2) => this.renderRaw(line1, line2));
        this.init();
    }

    private writeBytes(control: number, payload: number[]): void {
        const buf = Buffer.from([control, ...payload]);
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

    private command(value: number): void {
        this.writeBytes(CONTROL_COMMAND, [value]);
        // Clear Display / Return Home need ~1.53ms before the next command;
        // other commands ~39us (already slower than that in practice over
        // I2C at typical clock speeds) - only Clear needs an explicit wait.
        if (value === LCD_CLEAR_DISPLAY) {
            sleepMs(2);
        }
    }

    private writeChars(text: string): void {
        if (text.length === 0) {
            return;
        }
        this.writeBytes(
            CONTROL_DATA,
            Array.from(text, (ch) => ch.charCodeAt(0))
        );
    }

    private init(): void {
        // Power-on reset is automatic (~50ms) but does not apply the basic
        // settings - an explicit init sequence is still required.
        sleepMs(50);

        this.command(LCD_FUNCTION_SET_2LINE);
        this.command(LCD_DISPLAY_ON);
        this.command(LCD_CLEAR_DISPLAY);
        this.command(LCD_ENTRY_MODE_SET);
    }

    private setCursor(col: number, row: number): void {
        const rowOffset = row === 0 ? 0 : LINE2_DDRAM_OFFSET;
        this.command(LCD_SET_DDRAM_ADDR | (rowOffset + col));
    }

    private renderLine(row: number, text: string): void {
        this.setCursor(0, row);
        const padded = text.slice(0, LINE_WIDTH).padEnd(LINE_WIDTH, " ");
        this.writeChars(padded);
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
        if (this.clock.isActive) {
            return;
        }
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
        if (this.clock.isActive) {
            return;
        }
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

    setPower(on: boolean): void {
        if (on === !this.clock.isActive) {
            return;
        }
        if (on) {
            this.clock.hideClock();
            this.command(LCD_DISPLAY_ON);
            this.startPersistentTimers();
            this.renderPersistent();
            logger.log("[LCD] Display powered on");
        } else {
            this.clearTimers();
            if (this.transientTimer) {
                clearTimeout(this.transientTimer);
                this.transientTimer = undefined;
            }
            this.clock.showClock();
            logger.log("[LCD] Entering idle, showing clock");
        }
    }

    stop(): void {
        this.clearTimers();
        this.clock.hideClock();
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
