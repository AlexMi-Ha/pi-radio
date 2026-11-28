import { buildBootAnimationFrames } from "./BootAnimationFrames";

// Plays the startup wave animation through a display adapter's own raw
// render primitive, then calls back. Shared across adapters the same way
// ClockDisplayComponent is, so the frame sequence/timing lives in one place.
export class BootAnimationComponent {

    private render: (line1: string, line2: string) => void;
    private timer: NodeJS.Timeout | undefined;

    constructor(render: (line1: string, line2: string) => void) {
        this.render = render;
    }

    play(onDone: () => void, frameIntervalMs: number = 70): void {
        const frames = buildBootAnimationFrames();
        let index = 0;

        const renderNext = () => {
            const frame = frames[index];
            if (!frame) {
                this.stop();
                onDone();
                return;
            }
            this.render(frame[0], frame[1]);
            index++;
        };

        renderNext();
        this.timer = setInterval(renderNext, frameIntervalMs);
    }

    stop(): void {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = undefined;
        }
    }
}
