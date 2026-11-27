import { DisplayPort } from "../../core/ports/DisplayPort";
import { logger } from "../../core/util/Logger";
import { ClockDisplayComponent } from "./ClockDisplayComponent";

export class MockDisplayPort implements DisplayPort {

    private clock: ClockDisplayComponent;

    private persistentLine1 = "";
    private persistentLine2 = "";
    private persistentOptions: { blink?: boolean } = {};
    private transientTimer: NodeJS.Timeout | undefined = undefined;

    constructor() {
        this.clock = new ClockDisplayComponent((line1, line2) => {
            logger.log(`[Display] "${line1}" / "${line2}"`);
        });
    }

    showLines(line1: string, line2?: string, options?: { blink?: boolean }): void {
        if (this.transientTimer) {
            clearTimeout(this.transientTimer);
            this.transientTimer = undefined;
        }
        this.persistentLine1 = line1;
        this.persistentLine2 = line2 ?? "";
        this.persistentOptions = options ?? {};

        if (this.clock.isActive) {
            return;
        }
        logger.log(`[Display] "${line1}" / "${line2 ?? ""}"` + (options?.blink ? " (blinking)" : ""));
    }

    showTransient(line1: string, line2?: string, durationMs: number = 2000): void {
        if (this.transientTimer) {
            clearTimeout(this.transientTimer);
            this.transientTimer = undefined;
        }

        if (this.clock.isActive) {
            return;
        }
        logger.log(`[Display] transient "${line1}" / "${line2 ?? ""}" for ${durationMs}ms`);

        this.transientTimer = setTimeout(() => {
            this.transientTimer = undefined;
            logger.log(`[Display] "${this.persistentLine1}" / "${this.persistentLine2}"` + (this.persistentOptions.blink ? " (blinking)" : ""));
        }, durationMs);
    }

    setPower(on: boolean): void {
        if (on) {
            this.clock.hideClock();
        } else {
            this.clock.showClock();
        }
        logger.log(`[Display] power ${on ? "on" : "off"}`);
    }
}
