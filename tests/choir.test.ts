import { describe, expect, it } from "vitest";
import { CHOIR, choirIntervals, choirJobs } from "../src/voice/choir";
import type { TuneJob } from "../src/voice/tune";

const C_MAJOR = [0, 2, 4, 5, 7, 9, 11];
const C = { voicing: [60, 64, 67], bassRoot: 48 };
const CMAJ7 = { voicing: [60, 64, 67, 71], bassRoot: 48 };
const F = { voicing: [60, 65, 69], bassRoot: 41 };

/** A melody that holds `note` in the first step of bar `bar` and is quiet elsewhere. */
function melodyWith(note: number, bar = 0): (number | null)[] {
  return Array.from({ length: 64 }, (_, step) => (step === bar * 16 ? note : null));
}

const interval = (note: number, direction: 1 | -1, harmony = [C, C, C, C], bar = 0) =>
  choirIntervals(melodyWith(note, bar), harmony, C_MAJOR, direction)[bar * 16];

describe("choirIntervals", () => {
  it("puts the voices on the nearest chord tones above and below a chord tone", () => {
    expect([interval(64, 1), interval(64, -1)]).toEqual([3, -4]);
    expect([interval(72, 1), interval(72, -1)]).toEqual([4, -5]);
    expect([interval(67, 1), interval(67, -1)]).toEqual([5, -3]);
  });

  it("goes a third up and down in the key over a passing note", () => {
    expect([interval(62, 1), interval(62, -1)]).toEqual([3, -3]);
    expect([interval(65, 1), interval(65, -1)]).toEqual([4, -3]);
  });

  it("never comes closer than a minor third, not even to a seventh", () => {
    expect([interval(71, 1, [CMAJ7, C, C, C]), interval(71, -1, [CMAJ7, C, C, C])]).toEqual([5, -4]);
    for (const note of [60, 62, 64, 65, 67, 69, 71]) {
      for (const direction of [1, -1] as const) expect(Math.abs(interval(note, direction, [CMAJ7, C, C, C])!), `${note} ${direction}`).toBeGreaterThanOrEqual(3);
    }
  });

  it("follows the chord of each bar and stays quiet between hook notes", () => {
    expect(interval(69, 1, [C, F, C, C], 1)).toBe(3);
    const intervals = choirIntervals(melodyWith(64), [C, C, C, C], C_MAJOR, 1);
    expect(intervals.filter((value) => value !== null)).toHaveLength(1);
  });
});

describe("choirJobs", () => {
  it("makes one job per choir voice from the lead's job", () => {
    const lead: TuneJob = { samples: new Float32Array(10), sampleRate: 16_000, recordedTempo: 150, tempo: 150, startStep: 0, targets: melodyWith(64), scale: C_MAJOR, sugar: 0.5 };
    const jobs = choirJobs(lead, { melody: lead.targets, harmony: [C, C, C, C] }, C_MAJOR);
    expect(jobs).toHaveLength(CHOIR.length);
    expect(jobs.map((job) => job.harmony!.scaleSteps)).toEqual(CHOIR.map((voice) => 2 * voice.direction));
    expect(jobs.map((job) => job.harmony!.intervals[0])).toEqual([3, -4]);
    expect(jobs.map((job) => job.formantShift)).toEqual(CHOIR.map((voice) => voice.formantShift));
    for (const job of jobs) expect(job.targets).toBe(lead.targets);
  });
});
