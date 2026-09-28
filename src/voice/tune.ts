/*
 * The coin slot's voice processing, free of audio APIs so it runs in a worker
 * and in unit tests: find the singer's pitch (YIN), then rebuild the voice
 * grain by grain at the pitch of the hook melody (TD-PSOLA). The grains are
 * read a little faster than recorded, which lifts the formants: the bright,
 * small voice of hyperpop. The timing stays the singer's.
 */

export const TUNE_LOOP_STEPS = 64;

export interface TuneJob {
  /** The recording, mono. */
  samples: Float32Array;
  sampleRate: number;
  /** Tempo while it was recorded, and the tempo to render for. */
  recordedTempo: number;
  tempo: number;
  /** Loop position (sixteenths) of the first sample. */
  startStep: number;
  /** Per loop step: the MIDI note of the hook sounding there, or `null` between its notes. */
  targets: (number | null)[];
  /** Pitch classes of the key, for the sung notes between hook notes. */
  scale: number[];
  /** 0–1: how high the voice goes (octave choice) and how small it sounds (formants). */
  sugar: number;
  /**
   * A choir voice: per loop step, how many semitones it sings away from the
   * hook note (after the hook note's octave is chosen, so it stays above or
   * below the lead); between hook notes it moves `scaleSteps` through the key.
   */
  harmony?: { intervals: (number | null)[]; scaleSteps: number };
  /** Extra formant lift in semitones, so a choir voice sounds like another singer. */
  formantShift?: number;
}

export interface TuneResult {
  /** One loop at the render tempo, the voice placed where it was sung. */
  samples: Float32Array;
  sampleRate: number;
  /** Share of the recording in which a pitch was found; near 0 means nothing was sung. */
  voicedShare: number;
}

export interface PitchTrack {
  /** Seconds between frames. */
  hop: number;
  /** Seconds from the start of the recording to the centre of frame 0. */
  offset: number;
  /** Frequency per frame in Hz, 0 where unvoiced. */
  f0: Float32Array;
}

const MIN_HZ = 70;
const MAX_HZ = 1000;
const YIN_THRESHOLD = 0.15;
const UNVOICED_ABOVE = 0.35;

export function midiToHz(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

export function hzToMidi(hz: number): number {
  return 69 + 12 * Math.log2(hz / 440);
}

/** YIN on a copy decimated to about 16 kHz: 32 ms windows every 10 ms. */
export function detectPitch(samples: Float32Array, sampleRate: number): PitchTrack {
  const factor = Math.max(1, Math.round(sampleRate / 16_000));
  const rate = sampleRate / factor;
  const low = new Float32Array(Math.floor(samples.length / factor));
  for (let index = 0; index < low.length; index += 1) {
    let sum = 0;
    for (let offset = 0; offset < factor; offset += 1) sum += samples[index * factor + offset]!;
    low[index] = sum / factor;
  }
  const window = Math.round(0.032 * rate);
  const tauMin = Math.max(2, Math.floor(rate / MAX_HZ));
  const tauMax = Math.ceil(rate / MIN_HZ);
  const hop = Math.round(0.01 * rate);
  const frames = Math.max(0, Math.floor((low.length - window - tauMax) / hop) + 1);
  const f0 = new Float32Array(frames);
  const rms = new Float32Array(frames);
  const diff = new Float32Array(tauMax + 1);
  let loudest = 0;
  for (let frame = 0; frame < frames; frame += 1) {
    const start = frame * hop;
    let energy = 0;
    for (let index = 0; index < window; index += 1) energy += low[start + index]! ** 2;
    rms[frame] = Math.sqrt(energy / window);
    loudest = Math.max(loudest, rms[frame]!);
  }
  for (let frame = 0; frame < frames; frame += 1) {
    if (rms[frame]! < loudest * 0.05 || rms[frame]! < 1e-4) continue;
    const start = frame * hop;
    diff[0] = 1;
    let running = 0;
    for (let tau = 1; tau <= tauMax; tau += 1) {
      let sum = 0;
      for (let index = 0; index < window; index += 1) {
        const delta = low[start + index]! - low[start + index + tau]!;
        sum += delta * delta;
      }
      running += sum;
      diff[tau] = running > 0 ? (sum * tau) / running : 1;
    }
    let best = -1;
    for (let tau = tauMin; tau <= tauMax; tau += 1) {
      if (diff[tau]! < YIN_THRESHOLD) {
        while (tau + 1 <= tauMax && diff[tau + 1]! < diff[tau]!) tau += 1;
        best = tau;
        break;
      }
    }
    if (best < 0) {
      best = tauMin;
      for (let tau = tauMin; tau <= tauMax; tau += 1) if (diff[tau]! < diff[best]!) best = tau;
      if (diff[best]! > UNVOICED_ABOVE) continue;
    }
    const before = diff[Math.max(tauMin, best - 1)]!;
    const after = diff[Math.min(tauMax, best + 1)]!;
    const bend = before + after - 2 * diff[best]!;
    const refined = bend > 0 ? best + (before - after) / (2 * bend) : best;
    f0[frame] = rate / refined;
  }
  smooth(f0);
  return { hop: hop / rate, offset: window / 2 / rate, f0 };
}

/** A median of five over voiced frames removes single-frame octave slips. */
function smooth(f0: Float32Array): void {
  const source = f0.slice();
  for (let frame = 0; frame < f0.length; frame += 1) {
    if (source[frame] === 0) continue;
    const around: number[] = [];
    for (let offset = -2; offset <= 2; offset += 1) {
      const value = source[frame + offset];
      if (value) around.push(value);
    }
    around.sort((a, b) => a - b);
    f0[frame] = around[Math.floor(around.length / 2)]!;
  }
}

function pitchAt(track: PitchTrack, seconds: number): number {
  const frame = Math.round((seconds - track.offset) / track.hop);
  return track.f0[Math.max(0, Math.min(track.f0.length - 1, frame))] ?? 0;
}

/** The pitch class of `target` in the octave nearest to `around`. */
function nearestOctave(target: number, around: number): number {
  return target + 12 * Math.round((around - target) / 12);
}

function nearestScaleNote(midi: number, scale: readonly number[]): number {
  let best = Math.round(midi);
  let distance = Infinity;
  for (let candidate = Math.floor(midi) - 6; candidate <= Math.ceil(midi) + 6; candidate += 1) {
    if (!scale.includes(((candidate % 12) + 12) % 12)) continue;
    if (Math.abs(candidate - midi) < distance) {
      distance = Math.abs(candidate - midi);
      best = candidate;
    }
  }
  return best;
}

/** Moves `steps` notes of the key up (positive) or down from `midi`. */
export function moveInScale(midi: number, steps: number, scale: readonly number[]): number {
  const direction = Math.sign(steps);
  let note = midi;
  for (let moved = 0; moved < Math.abs(steps);) {
    note += direction;
    if (scale.includes(((note % 12) + 12) % 12)) moved += 1;
  }
  return note;
}

function sampleAt(samples: Float32Array, position: number): number {
  const index = Math.floor(position);
  if (index < 0 || index + 1 >= samples.length) return 0;
  const fraction = position - index;
  return samples[index]! * (1 - fraction) + samples[index + 1]! * fraction;
}

interface Mark {
  position: number;
  /** Local period in samples; for unvoiced marks the analysis hop. */
  period: number;
  voiced: boolean;
  hz: number;
}

/** Analysis marks: one per pitch period on the waveform's peaks where voiced, every 5 ms elsewhere. */
function analysisMarks(samples: Float32Array, sampleRate: number, track: PitchTrack): Mark[] {
  const marks: Mark[] = [];
  const hop = Math.round(0.005 * sampleRate);
  let position = 0;
  let previousVoiced = false;
  while (position < samples.length) {
    const hz = pitchAt(track, position / sampleRate);
    if (hz > 0) {
      const period = sampleRate / hz;
      let peak = Math.round(position);
      if (!previousVoiced) {
        // Entering a voiced stretch: anchor on the largest peak of the first period.
        let best = 0;
        for (let index = peak; index < Math.min(samples.length, peak + period); index += 1) {
          if (Math.abs(samples[index]!) > best) {
            best = Math.abs(samples[index]!);
            position = index;
          }
        }
      } else {
        // Follow the peaks, allowing a fifth of a period of drift.
        const reach = Math.max(1, Math.round(period * 0.2));
        let best = -1;
        for (let index = Math.max(0, peak - reach); index <= Math.min(samples.length - 1, peak + reach); index += 1) {
          if (Math.abs(samples[index]!) > best) {
            best = Math.abs(samples[index]!);
            peak = index;
          }
        }
        position = peak;
      }
      marks.push({ position, period, voiced: true, hz });
      position += period;
      previousVoiced = true;
    } else {
      marks.push({ position, period: hop, voiced: false, hz: 0 });
      position += hop;
      previousVoiced = false;
    }
  }
  return marks;
}

/** What a take's tunings share: its pitch track and its analysis marks, most of the work. */
export interface TakeAnalysis {
  track: PitchTrack;
  marks: Mark[];
}

export function analyseTake(samples: Float32Array, sampleRate: number): TakeAnalysis {
  const track = detectPitch(samples, sampleRate);
  return { track, marks: analysisMarks(samples, sampleRate, track) };
}

/**
 * Keeps the last take's analysis: the voice, its lifted twin and the four
 * choir voices all come from the same take, so it is analysed once.
 */
export class TakeAnalyser {
  private key = "";
  private analysis: TakeAnalysis | null = null;

  analyse(samples: Float32Array, sampleRate: number): TakeAnalysis {
    const key = fingerprint(samples, sampleRate);
    if (key !== this.key || !this.analysis) {
      this.analysis = analyseTake(samples, sampleRate);
      this.key = key;
    }
    return this.analysis;
  }
}

/** Tells takes apart cheaply: rate, length and a few hundred samples. */
function fingerprint(samples: Float32Array, sampleRate: number): string {
  let sum = 0;
  const stride = Math.max(1, Math.floor(samples.length / 509));
  for (let index = 0; index < samples.length; index += stride) sum += samples[index]! * (1 + (index % 7));
  return `${sampleRate}:${samples.length}:${sum}`;
}

export function tuneVoice(job: TuneJob, analysis: TakeAnalysis = analyseTake(job.samples, job.sampleRate)): TuneResult {
  const { samples, sampleRate } = job;
  const { track, marks } = analysis;
  const oldStep = 15 / job.recordedTempo;
  const newStep = 15 / job.tempo;
  const stretch = newStep / oldStep;
  const loopLength = Math.round(TUNE_LOOP_STEPS * newStep * sampleRate);
  const out = new Float32Array(loopLength);
  const weight = new Float32Array(loopLength);
  const sugar = Math.max(0, Math.min(1, job.sugar));
  const lift = sugar * 12;
  const formant = 2 ** ((2 + sugar * 5 + (job.formantShift ?? 0)) / 12);
  const span = Math.min(loopLength, Math.round((samples.length / sampleRate) * stretch * sampleRate));
  const wrapStep = ((job.startStep % TUNE_LOOP_STEPS) + TUNE_LOOP_STEPS) % TUNE_LOOP_STEPS;
  const offset = Math.round(wrapStep * newStep * sampleRate);

  let markIndex = 0;
  let outPosition = 0;
  while (outPosition < span && marks.length > 0) {
    const inPosition = outPosition / stretch;
    while (markIndex + 1 < marks.length && Math.abs(marks[markIndex + 1]!.position - inPosition) <= Math.abs(marks[markIndex]!.position - inPosition)) markIndex += 1;
    const mark = marks[markIndex]!;
    let spacing = mark.period;
    if (mark.voiced) {
      const sung = hzToMidi(mark.hz);
      const step = Math.floor(wrapStep + inPosition / sampleRate / oldStep) % TUNE_LOOP_STEPS;
      const target = job.targets[step] ?? null;
      let note = target !== null ? nearestOctave(target, sung + lift) : nearestScaleNote(sung + lift, job.scale);
      if (job.harmony) {
        const interval = target !== null ? job.harmony.intervals[step] ?? null : null;
        note = interval !== null ? note + interval : moveInScale(note, job.harmony.scaleSteps, job.scale);
      }
      spacing = sampleRate / midiToHz(note);
    }
    const half = Math.max(2, Math.floor(mark.period / formant));
    const centre = Math.round(outPosition);
    for (let k = -half; k <= half; k += 1) {
      const target = offset + centre + k;
      if (centre + k < 0 || centre + k >= span) continue;
      const index = ((target % loopLength) + loopLength) % loopLength;
      const w = 0.5 + 0.5 * Math.cos((Math.PI * k) / half);
      out[index] = out[index]! + w * sampleAt(samples, mark.position + k * formant);
      weight[index] = weight[index]! + w;
    }
    outPosition += spacing;
  }

  let peak = 0;
  let previousIn = 0;
  let previousOut = 0;
  const highpass = Math.exp((-2 * Math.PI * 90) / sampleRate);
  const fade = Math.round(0.008 * sampleRate);
  for (let n = 0; n < span; n += 1) {
    const index = (offset + n) % loopLength;
    const value = out[index]! / Math.max(1, weight[index]!);
    // A gentle high-pass keeps breath rumble and handling noise out.
    const filtered = highpass * (previousOut + value - previousIn);
    previousIn = value;
    previousOut = filtered;
    const edge = Math.min(1, n / fade, (span - 1 - n) / fade);
    out[index] = filtered * Math.max(0, edge);
    peak = Math.max(peak, Math.abs(out[index]!));
  }
  if (peak > 0) for (let index = 0; index < loopLength; index += 1) out[index] = (out[index]! / peak) * 0.8;

  const voiced = track.f0.reduce((count, hz) => count + (hz > 0 ? 1 : 0), 0);
  return { samples: out, sampleRate, voicedShare: track.f0.length ? voiced / track.f0.length : 0 };
}
