import { TakeAnalyser, tuneVoice, type TuneJob } from "./tune";

const analyser = new TakeAnalyser();

// Tunes voices off the main thread, so the reels keep spinning smoothly.
self.onmessage = (event: MessageEvent<{ id: number; jobs: TuneJob[] }>) => {
  const results = event.data.jobs.map((job) => tuneVoice(job, analyser.analyse(job.samples, job.sampleRate)));
  self.postMessage({ id: event.data.id, results }, { transfer: results.map((result) => result.samples.buffer) });
};
