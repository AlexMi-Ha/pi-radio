import { DisplayPort } from "../../core/ports/DisplayPort";
import { logger } from "../../core/util/Logger";

export class MockDisplayPort implements DisplayPort {

    showLines(line1: string, line2?: string, options?: { blink?: boolean }): void {
        logger.log(`[Display] "${line1}" / "${line2 ?? ""}"` + (options?.blink ? " (blinking)" : ""));
    }

    showTransient(line1: string, line2?: string, durationMs: number = 2000): void {
        logger.log(`[Display] transient "${line1}" / "${line2 ?? ""}" for ${durationMs}ms`);
    }

    setPower(on: boolean): void {
        logger.log(`[Display] power ${on ? "on" : "off"}`);
    }
}
