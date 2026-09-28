/*
 * The choir: the same take sung twice more, next to the lead. One voice takes
 * the nearest chord tone above the hook note, the other the nearest one
 * below, from the chord of the bar; where the hook note is no chord tone,
 * they go a third up and down in the key. Each voice sits off to one side,
 * a little quieter, a few milliseconds late and with its own formant, so the
 * three sound like a small choir rather than an effect.
 */

import type { LoopData } from "../music/loop";
import { STEPS_PER_BAR } from "../music/loop";
import type { TuneJob } from "./tune";
import { moveInScale } from "./tune";

export interface ChoirVoiceSpec {
  /** Above (1) or below (-1) the hook. */
  direction: 1 | -1;
  /** Stereo position, -1 left to 1 right. */
  pan: number;
  /** Level against the lead voice. */
  level: number;
  /** Seconds late, like a second singer. */
  delay: number;
  /** Formant offset in semitones: a slightly smaller or bigger voice. */
  formantShift: number;
}

export const CHOIR: readonly ChoirVoiceSpec[] = [
  { direction: 1, pan: -0.65, level: 0.5, delay: 0.014, formantShift: 1 },
  { direction: -1, pan: 0.65, level: 0.58, delay: 0.022, formantShift: -1.5 },
];

/** The closest a choir voice comes to the lead, so it never rubs a second against it. */
const MIN_GAP = 3;

const pitchClass = (midi: number) => ((midi % 12) + 12) % 12;

/** Per loop step: how far the choir voice sings from the hook note, `null` between hook notes. */
export function choirIntervals(melody: readonly (number | null)[], harmony: LoopData["harmony"], scale: readonly number[], direction: 1 | -1): (number | null)[] {
  return melody.map((note, step) => {
    if (note === null) return null;
    const bar = harmony[Math.floor(step / STEPS_PER_BAR) % Math.max(1, harmony.length)];
    const chord = new Set((bar?.voicing ?? []).map(pitchClass));
    if (chord.has(pitchClass(note))) {
      for (let gap = MIN_GAP; gap < 12; gap += 1) if (chord.has(pitchClass(note + direction * gap))) return direction * gap;
    }
    return moveInScale(note, 2 * direction, scale) - note;
  });
}

/**
 * The choir's tune jobs for one tuning of the lead (plain or lifted). The
 * intervals come from the untransposed loop, so they fit the lifted chorus
 * as well: everything moves up together.
 */
export function choirJobs(lead: TuneJob, loop: Pick<LoopData, "melody" | "harmony">, scale: readonly number[]): TuneJob[] {
  return CHOIR.map((voice) => ({
    ...lead,
    harmony: { intervals: choirIntervals(loop.melody, loop.harmony, scale, voice.direction), scaleSteps: 2 * voice.direction },
    formantShift: voice.formantShift,
  }));
}
