import { describe, expect, it } from "vitest";
import { detectPitch, hzToMidi, tuneVoice, type TuneJob } from "../src/voice/tune";

const RATE = 16_000;
const C_MAJOR = [0, 2, 4, 5, 7, 9, 11];

/** A vowel-like tone: a fundamental with falling harmonics and a little vibrato. */
function voice(hz: number, seconds: number, rate = RATE, vibrato = 0): Float32Array {
  const samples = new Float32Array(Math.round(seconds * rate));
  let phase = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const f = hz * 2 ** ((vibrato * Math.sin((2 * Math.PI * 5.5 * index) / rate)) / 1200);
    phase += (2 * Math.PI * f) / rate;
    samples[index] = 0.5 * Math.sin(phase) + 0.25 * Math.sin(2 * phase) + 0.12 * Math.sin(3 * phase);
  }
  return samples;
}

function job(overrides: Partial<TuneJob>): TuneJob {
  return {
    samples: voice(200, 1.2),
    sampleRate: RATE,
    recordedTempo: 150,
    tempo: 150,
    startStep: 0,
    targets: Array.from({ length: 64 }, () => 69),
    scale: C_MAJOR,
    sugar: 0,
    ...overrides,
  };
}

/** Median detected pitch between two times of a rendered loop. */
function pitchBetween(samples: Float32Array, from: number, to: number): number {
  const part = samples.slice(Math.round(from * RATE), Math.round(to * RATE));
  const values = Array.from(detectPitch(part, RATE).f0).filter((hz) => hz > 0).sort((a, b) => a - b);
  return values[Math.floor(values.length / 2)] ?? 0;
}

describe("detectPitch", () => {
  it("finds the pitch of a sung vowel and nothing in silence", () => {
    for (const hz of [98, 220, 440, 700]) {
      const track = detectPitch(voice(hz, 0.5, RATE, 20), RATE);
      const voiced = Array.from(track.f0).filter((value) => value > 0);
      expect(voiced.length).toBeGreaterThan(track.f0.length * 0.8);
      const median = voiced.sort((a, b) => a - b)[Math.floor(voiced.length / 2)]!;
      expect(Math.abs(hzToMidi(median) - hzToMidi(hz)), `${hz} Hz`).toBeLessThan(0.3);
    }
    expect(Array.from(detectPitch(new Float32Array(RATE), RATE).f0).every((hz) => hz === 0)).toBe(true);
  });

  it("works at 48 kHz too", () => {
    const track = detectPitch(voice(196, 0.4, 48_000), 48_000);
    const voiced = Array.from(track.f0).filter((value) => value > 0);
    expect(Math.abs(hzToMidi(voiced[Math.floor(voiced.length / 2)]!) - hzToMidi(196))).toBeLessThan(0.3);
  });
});

describe("tuneVoice", () => {
  it("pulls the voice onto the hook note in the singer's own octave", () => {
    const result = tuneVoice(job({ sugar: 0 }));
    expect(result.voicedShare).toBeGreaterThan(0.8);
    expect(Math.abs(hzToMidi(pitchBetween(result.samples, 0.1, 1.0)) - 57)).toBeLessThan(0.35);
  });

  it("goes an octave up with a lot of sugar", () => {
    const result = tuneVoice(job({ sugar: 1 }));
    expect(Math.abs(hzToMidi(pitchBetween(result.samples, 0.1, 1.0)) - 69)).toBeLessThan(0.35);
  });

  it("follows the melody note by note and snaps to the key between hook notes", () => {
    const targets: (number | null)[] = Array.from({ length: 64 }, (_, step) => (step < 6 ? 60 : step < 12 ? 64 : null));
    const result = tuneVoice(job({ samples: voice(210, 1.6), targets, sugar: 0 }));
    expect(Math.abs(hzToMidi(pitchBetween(result.samples, 0.1, 0.55)) - 60)).toBeLessThan(0.35);
    expect(Math.abs(hzToMidi(pitchBetween(result.samples, 0.7, 1.15)) - 52)).toBeLessThan(0.35);
    // 210 Hz is MIDI 56.2, between G3 and A3 in C major; A3 is nearer.
    expect(Math.abs(hzToMidi(pitchBetween(result.samples, 1.3, 1.55)) - 57)).toBeLessThan(0.35);
  });

  it("places the voice where it was sung and returns one whole loop", () => {
    const result = tuneVoice(job({ startStep: 8 }));
    expect(result.samples.length).toBe(Math.round(64 * 0.1 * RATE));
    const before = result.samples.slice(0, Math.round(0.78 * RATE)).reduce((max, value) => Math.max(max, Math.abs(value)), 0);
    const during = result.samples.slice(Math.round(0.9 * RATE), Math.round(1.8 * RATE)).reduce((max, value) => Math.max(max, Math.abs(value)), 0);
    expect(before).toBe(0);
    expect(during).toBeGreaterThan(0.3);
  });

  it("wraps a voice sung across the end of the loop back to its start", () => {
    const result = tuneVoice(job({ startStep: 60 }));
    const start = result.samples.slice(0, Math.round(0.5 * RATE)).reduce((max, value) => Math.max(max, Math.abs(value)), 0);
    expect(start).toBeGreaterThan(0.3);
  });

  it("stretches the timing to a new tempo and keeps the pitch", () => {
    const result = tuneVoice(job({ tempo: 120 }));
    expect(result.samples.length).toBe(Math.round(64 * 0.125 * RATE));
    let last = 0;
    for (let index = 0; index < result.samples.length; index += 1) if (Math.abs(result.samples[index]!) > 0.01) last = index;
    expect(last / RATE).toBeGreaterThan(1.35);
    expect(last / RATE).toBeLessThan(1.55);
    expect(Math.abs(hzToMidi(pitchBetween(result.samples, 0.1, 1.2)) - 57)).toBeLessThan(0.35);
  });

  it("returns silence for silence", () => {
    const result = tuneVoice(job({ samples: new Float32Array(RATE) }));
    expect(result.voicedShare).toBe(0);
    expect(result.samples.every((value) => value === 0)).toBe(true);
  });
});
