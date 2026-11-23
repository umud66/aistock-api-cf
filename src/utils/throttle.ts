/** Per-isolate serialization; not a distributed rate limiter. */
export const DEFAULT_THROTTLE_MS = 300;
export function createThrottler(defaultMs: number = DEFAULT_THROTTLE_MS) {
    let lastTime = 0;
    let queue: Promise<void> = Promise.resolve();
    return {
        throttle(ms: number = defaultMs): Promise<void> {
            const task = queue.then(async () => {
                const wait = Math.max(0, ms - (Date.now() - lastTime));
                if (wait) await new Promise<void>(resolve => setTimeout(resolve, wait));
                lastTime = Date.now();
            });
            queue = task.catch(() => {});
            return task;
        },
        reset(): void { lastTime = 0; },
    };
}
const shared = createThrottler();
export const throttle = shared.throttle;
export const resetThrottle = shared.reset;
