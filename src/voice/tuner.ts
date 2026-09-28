import type { TuneJob, TuneResult } from "./tune";
import { tuneVoice } from "./tune";

/** Runs voice tuning in a worker; a newer request makes an older one's answer irrelevant. */
export class VoiceTuner {
  private worker: Worker | null = null;
  private latest = 0;
  private pending = new Map<number, (result: TuneResult | null) => void>();

  tune(job: TuneJob): Promise<TuneResult | null> {
    const id = (this.latest += 1);
    for (const [older, resolve] of this.pending) if (older < id) resolve(null);
    try {
      this.worker ??= this.createWorker();
    } catch {
      this.worker = null;
    }
    if (!this.worker) return Promise.resolve(tuneVoice(job));
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      this.worker!.postMessage({ id, job });
    });
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    for (const resolve of this.pending.values()) resolve(null);
    this.pending.clear();
  }

  private createWorker(): Worker {
    const worker = new Worker(new URL("./tune.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<{ id: number; result: TuneResult }>) => {
      const resolve = this.pending.get(event.data.id);
      this.pending.delete(event.data.id);
      resolve?.(event.data.id === this.latest ? event.data.result : null);
    };
    return worker;
  }
}
