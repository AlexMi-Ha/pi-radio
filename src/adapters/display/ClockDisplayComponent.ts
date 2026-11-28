const DAY_NAMES_SHORT = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const LINE_WIDTH = 16;

function pad2(n: number): string {
    return n.toString().padStart(2, "0");
}

function center(text: string): string {
    const totalPad = LINE_WIDTH - text.length;
    const left = Math.floor(totalPad / 2);
    return " ".repeat(Math.max(left, 0)) + text;
}

// Day+date is kept to 11 chars ("Do 28.11.26") so it fits well within the
// 16-char LCD line width, unlike the previous full-day-name/4-digit-year
// format which overflowed it (e.g. "Donnerstag 28/11/2026"). Both lines are
// then centered for a tidier idle screen.
function formatClockLines(date: Date): [string, string] {
    const line1 = `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
    const line2 = `${DAY_NAMES_SHORT[date.getDay()]} ${pad2(date.getDate())}.${pad2(date.getMonth() + 1)}.${pad2(date.getFullYear() % 100)}`;
    return [center(line1), center(line2)];
}

// Renders a self-correcting, minute-aligned clock through a display
// adapter's own write primitive. A DisplayPort implementation composes
// one of these and drives it from its own setPower() - this keeps the
// clock's formatting/scheduling logic in one place without forcing every
// adapter to reimplement it, while leaving each adapter in control of what
// "idle" otherwise means for its own hardware (e.g. whether it also cuts a
// real backlight).
export class ClockDisplayComponent {

    private render: (line1: string, line2: string) => void;
    private timer: NodeJS.Timeout | undefined;
    private active: boolean = false;

    constructor(render: (line1: string, line2: string) => void) {
        this.render = render;
    }

    get isActive(): boolean {
        return this.active;
    }

    showClock(): void {
        this.active = true;
        this.renderNow();
        this.scheduleTick();
    }

    hideClock(): void {
        this.active = false;
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = undefined;
        }
    }

    private scheduleTick(): void {
        const now = new Date();
        const msUntilNextMinute = 60000 - (now.getSeconds() * 1000 + now.getMilliseconds());
        this.timer = setTimeout(() => {
            this.renderNow();
            this.scheduleTick();
        }, msUntilNextMinute);
    }

    private renderNow(): void {
        const [line1, line2] = formatClockLines(new Date());
        this.render(line1, line2);
    }
}
