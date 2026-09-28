/** Calls `tick` about every 25 ms from a worker, or from a page timer where workers are missing. */
export class Clock {
  private worker: Worker | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly tick: () => void) {}

  start(): void {
    this.stop();
    try {
      this.worker ??= new Worker(new URL("./ticker.worker.ts", import.meta.url), { type: "module" });
      this.worker.onmessage = () => this.tick();
      this.worker.postMessage("start");
    } catch {
      this.worker = null;
      this.timer = setInterval(() => this.tick(), 25);
    }
  }

  stop(): void {
    this.worker?.postMessage("stop");
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  dispose(): void {
    this.stop();
    this.worker?.terminate();
    this.worker = null;
  }
}
