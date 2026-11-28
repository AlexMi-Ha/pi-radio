const LINE_WIDTH = 16;
const BLOCK = "\xFF";
const BLANK_LINE = " ".repeat(LINE_WIDTH);

function centered(text: string): string {
    const totalPad = LINE_WIDTH - text.length;
    const left = Math.floor(totalPad / 2);
    return (" ".repeat(Math.max(left, 0)) + text).padEnd(LINE_WIDTH, " ");
}

// Sweeps a solid block wall left-to-right over `target`, covering more of it
// as `step` increases (step 0: only column 0 is blocked; step 15: fully
// blocked).
function cover(target: string, step: number): string {
    return target
        .split("")
        .map((ch, i) => (i <= step ? BLOCK : ch))
        .join("");
}

// The inverse sweep: reveals `target` left-to-right as `step` increases,
// with the rest still hidden behind the block wall.
function reveal(target: string, step: number): string {
    return target
        .split("")
        .map((ch, i) => (i <= step ? ch : BLOCK))
        .join("");
}

// Builds the full startup animation as a flat list of (line1, line2) frames:
// a wave of blocks sweeps in over the blank screen, sweeps back out to
// reveal a centered "Hello", then sweeps back in to cover it again - the
// last frame leaves the screen fully blocked, ready to be overwritten by
// whatever shows next (normally the idle clock).
export function buildBootAnimationFrames(): Array<[string, string]> {
    const helloLine = centered("Hello");
    const frames: Array<[string, string]> = [];

    for (let step = 0; step < LINE_WIDTH; step++) {
        frames.push([cover(BLANK_LINE, step), cover(BLANK_LINE, step)]);
    }
    for (let step = 0; step < LINE_WIDTH; step++) {
        frames.push([reveal(helloLine, step), reveal(BLANK_LINE, step)]);
    }
    for (let step = 0; step < LINE_WIDTH; step++) {
        frames.push([cover(helloLine, step), cover(BLANK_LINE, step)]);
    }

    return frames;
}
