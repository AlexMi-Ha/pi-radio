import { buildBootAnimationFrames } from "../../../src/adapters/display/BootAnimationFrames";

const LINE_WIDTH = 16;
const BLOCK = "\xFF";

describe("buildBootAnimationFrames", () => {

    test("every frame is exactly 16 chars on both lines", () => {
        const frames = buildBootAnimationFrames();
        expect(frames.length).toBeGreaterThan(0);
        for (const [line1, line2] of frames) {
            expect(line1).toHaveLength(LINE_WIDTH);
            expect(line2).toHaveLength(LINE_WIDTH);
        }
    });

    test("starts with just the leading edge of the wave and covers up left-to-right into a solid wall of blocks", () => {
        const frames = buildBootAnimationFrames();
        const [first] = frames[0]!;
        expect(first).toBe(BLOCK + " ".repeat(LINE_WIDTH - 1));

        const coverPhaseEnd = frames[LINE_WIDTH - 1]!;
        expect(coverPhaseEnd[0]).toBe(BLOCK.repeat(LINE_WIDTH));
        expect(coverPhaseEnd[1]).toBe(BLOCK.repeat(LINE_WIDTH));
    });

    test("sweeps away to reveal a centered Hello on line 1", () => {
        const frames = buildBootAnimationFrames();
        const revealPhaseEnd = frames[2 * LINE_WIDTH - 1]!;
        expect(revealPhaseEnd[0]).toContain("Hello");
        expect(revealPhaseEnd[0]).not.toContain(BLOCK);
    });

    test("ends fully covered again, ready for whatever shows next", () => {
        const frames = buildBootAnimationFrames();
        const last = frames[frames.length - 1]!;
        expect(last[0]).toBe(BLOCK.repeat(LINE_WIDTH));
        expect(last[1]).toBe(BLOCK.repeat(LINE_WIDTH));
    });
});
