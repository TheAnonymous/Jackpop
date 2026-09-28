import { tuneVoice, type TuneJob } from "./tune";

// Tunes voices off the main thread, so the reels keep spinning smoothly.
self.onmessage = (event: MessageEvent<{ id: number; jobs: TuneJob[] }>) => {
  const results = event.data.jobs.map((job) => tuneVoice(job));
  self.postMessage({ id: event.data.id, results }, { transfer: results.map((result) => result.samples.buffer) });
};
