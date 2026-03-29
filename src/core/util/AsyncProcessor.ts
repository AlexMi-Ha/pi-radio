type Task = () => Promise<void>;

export class AsyncProcessor {

    private latestTask: Task | undefined;
    private running = false;

    private timer?: NodeJS.Timeout;

    runSafe(task: Task, debounceTime: number = 0) {
        
        if(debounceTime > 0) {
            if(this.timer) clearTimeout(this.timer);
            this.latestTask = task;
            this.timer = setTimeout(() => this.process, debounceTime);
        
        }else {
            this.latestTask = task;
            this.process();
        }
    }

    private async process() {
        if(this.running) return;
        this.running = true;

        while(this.latestTask) {
            const task = this.latestTask;
            this.latestTask = undefined;
            if(!task) continue;

            try {
                await task();
            }catch(err) {
                console.error("AsyncQueue task error:", err);
            }
        }
        this.running = false;
    }
}