export interface DisplayPort {
    // Sets the persistent two-line content. The adapter owns scrolling for
    // lines that overflow the physical display width.
    showLines(line1: string, line2?: string, options?: { blink?: boolean }): void;

    // Temporarily overlays the display with a message, then automatically
    // reverts to the last showLines() content after durationMs.
    showTransient(line1: string, line2?: string, durationMs?: number): void;

    // Turns the physical display (and backlight) on or off, e.g. while idle.
    // Turning back on re-renders the last persistent content.
    setPower(on: boolean): void;

    // Plays a one-off startup animation, then invokes onDone. Called once at
    // process startup, before any other content is shown.
    playBootAnimation(onDone: () => void): void;

    // Wipes the physical display immediately, with no persistent content
    // reapplied afterwards. Called once when the app is shutting down.
    clear(): void;
}
