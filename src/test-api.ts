import { PopEngine, type PlayMode, type SoloPart } from "./audio/engine";
import { renderInChunks } from "./audio/offline";
import type { Knobs } from "./audio/synth";
import { forceNextSpin } from "./machine/forced";
import { buildLoop, LOOP_STEPS, type ReelSetting } from "./music/loop";
import type { ReelId } from "./music/reels";
import { REELS } from "./music/reels";
import { createProject } from "./store";
import { tuneVoice } from "./voice/tune";

export interface RenderMetrics {
  peak: number;
  rmsDb: number;
  /** Share of 10 ms windows louder than -60 dBFS. */
  activeShare: number;
  nonFinite: number;
  nodes: number;
  seconds: number;
  /** Section labels in the order they started. */
  sections: string[];
  /** Whether the song played its ending. */
  ended: boolean;
}

export interface RenderOptions {
  positions?: Partial<Record<ReelId, number>>;
  knobs?: Partial<Knobs>;
  tempo?: number;
  seconds?: number;
  solo?: SoloPart;
  /** Put a sung "aah" at 200 Hz through the coin slot's tuning first. */
  voice?: boolean;
  /** Pull the lever at the start with this strength. */
  pull?: number;
  /** Let that pull be a jackpot (four hearts). */
  jackpot?: boolean;
  mode?: PlayMode;
}

export interface JackpopTestApi {
  render(options?: RenderOptions): Promise<RenderMetrics>;
  forceNextSpin(positions: Partial<Record<ReelId, number>>): void;
}

function metrics(buffer: AudioBuffer, nodes: number, sections: string[], ended: boolean): RenderMetrics {
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
  return { peak, rmsDb: rms > 0 ? 20 * Math.log10(rms) : -Infinity, activeShare: windows ? active / windows : 0, nonFinite, nodes, seconds: buffer.duration, sections, ended };
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
  if (options.voice) {
    const rate = context.sampleRate;
    const sung = new Float32Array(Math.round(rate * 2.5));
    let phase = 0;
    for (let index = 0; index < sung.length; index += 1) {
      phase += (2 * Math.PI * 200) / rate;
      sung[index] = 0.4 * Math.sin(phase) + 0.2 * Math.sin(2 * phase) + 0.1 * Math.sin(3 * phase);
    }
    const targets: (number | null)[] = Array.from({ length: LOOP_STEPS }, () => null);
    loop.hook.forEach((notes, step) => notes.forEach((note) => { for (let k = 0; k < note.len; k += 1) targets[(step + k) % LOOP_STEPS] = note.pitch; }));
    const tuned = tuneVoice({ samples: sung, sampleRate: rate, recordedTempo: project.tempo, tempo: options.tempo ?? project.tempo, startStep: 0, targets, scale: [0, 2, 4, 5, 7, 9, 11], sugar: options.knobs?.sugar ?? project.knobs.sugar });
    const buffer = context.createBuffer(1, tuned.samples.length, rate);
    buffer.getChannelData(0).set(tuned.samples);
    engine.setVoice(buffer);
  }
  if (options.solo) engine.setSolo(options.solo);
  if (options.mode) engine.setMode(options.mode);
  const jackpot = options.jackpot ? { family: "sweet" as const, count: 4, reels: [...REELS], jokers: 0 } : null;
  if (options.pull !== undefined) await engine.pull(options.pull, new Set(), loop, jackpot);
  const buffer = await renderInChunks(context, (until) => engine.renderUntil(until), seconds);
  const sections: string[] = [];
  let ended = false;
  for (const event of engine.drainEvents(Infinity)) {
    if (event.type === "end") ended = true;
    if (event.type === "step" && !event.spinning && sections[sections.length - 1] !== event.label) sections.push(event.label);
  }
  return metrics(buffer, nodes, sections, ended);
}

export function installTestApi(): void {
  window.__jackpopTest = { render, forceNextSpin };
  document.documentElement.dataset.audioTest = "ready";
}
