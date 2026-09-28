import { tuneVoice, type TuneJob } from "./tune";

// Tunes voices off the main thread, so the reels keep spinning smoothly.
self.onmessage = (event: MessageEvent<{ id: number; job: TuneJob }>) => {
  const result = tuneVoice(event.data.job);
  self.postMessage({ id: event.data.id, result }, { transfer: [result.samples.buffer] });
};
