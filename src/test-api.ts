import { PopEngine } from "./audio/engine";
import type { Knobs } from "./audio/synth";
import { forceNextSpin } from "./machine/forced";
import { buildLoop, type ReelSetting } from "./music/loop";
import type { ReelId } from "./music/reels";
import { REELS } from "./music/reels";
import { createProject } from "./store";

export interface RenderMetrics {
  peak: number;
  rmsDb: number;
  /** Share of 10 ms windows louder than -60 dBFS. */
  activeShare: number;
  nonFinite: number;
  nodes: number;
  seconds: number;
}

export interface RenderOptions {
  positions?: Partial<Record<ReelId, number>>;
  knobs?: Partial<Knobs>;
  tempo?: number;
  seconds?: number;
  solo?: ReelId;
  /** Pull the lever at the start with this strength. */
  pull?: number;
}

export interface JackpopTestApi {
  render(options?: RenderOptions): Promise<RenderMetrics>;
  forceNextSpin(positions: Partial<Record<ReelId, number>>): void;
}

function metrics(buffer: AudioBuffer, nodes: number): RenderMetrics {
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index));
  const window = Math.round(buffer.sampleRate * 0.01);
  let peak = 0;
  let sum = 0;
  let nonFinite = 0;
  let active = 0;
  let windows = 0;
  for (let start = 0; start < buffer.length; start += window) {
    const end = Math.min(buffer.length, start + window);
    let windowSum = 0;
    for (const data of channels) {
      for (let index = start; index < end; index += 1) {
        const sample = data[index]!;
        if (!Number.isFinite(sample)) {
          nonFinite += 1;
          continue;
        }
        peak = Math.max(peak, Math.abs(sample));
        windowSum += sample * sample;
      }
    }
    sum += windowSum;
    if (Math.sqrt(windowSum / ((end - start) * channels.length)) > 10 ** (-60 / 20)) active += 1;
    windows += 1;
  }
  const rms = Math.sqrt(sum / (buffer.length * channels.length));
  return { peak, rmsDb: rms > 0 ? 20 * Math.log10(rms) : -Infinity, activeShare: windows ? active / windows : 0, nonFinite, nodes, seconds: buffer.duration };
}

/** Renders the machine offline, counting every audio node it creates. */
async function render(options: RenderOptions = {}): Promise<RenderMetrics> {
  const project = createProject();
  const seconds = options.seconds ?? 4;
  const reels = Object.fromEntries(REELS.map((reel) => [reel, { ...project.reels[reel], position: options.positions?.[reel] ?? project.reels[reel].position }])) as Record<ReelId, ReelSetting>;
  const loop = buildLoop(project.key, reels);
  const context = new OfflineAudioContext(2, Math.ceil(seconds * 44_100), 44_100);
  let nodes = 0;
  for (const key of Object.getOwnPropertyNames(BaseAudioContext.prototype)) {
    if (!key.startsWith("create") || key === "createBuffer" || key === "createPeriodicWave") continue;
    const original = (context as unknown as Record<string, (...args: unknown[]) => unknown>)[key]!.bind(context);
    (context as unknown as Record<string, unknown>)[key] = (...args: unknown[]) => {
      nodes += 1;
      return original(...args);
    };
  }
  const engine = new PopEngine(loop, { knobs: { ...project.knobs, ...options.knobs }, tempo: options.tempo ?? project.tempo, volume: 1 }, { context });
  await engine.unlock();
  if (options.solo) engine.setSolo(options.solo);
  if (options.pull !== undefined) await engine.pull(options.pull, new Set(), loop, null);
  engine.renderUntil(seconds);
  const buffer = await context.startRendering();
  return metrics(buffer, nodes);
}

export function installTestApi(): void {
  window.__jackpopTest = { render, forceNextSpin };
  document.documentElement.dataset.audioTest = "ready";
}
