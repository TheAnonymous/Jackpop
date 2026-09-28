import { describe, expect, it } from "vitest";
import { chordInterval, chordPitchClasses, degreeSemitones, relativePitch, voiceChord } from "../src/music/theory";

describe("theory", () => {
  it("counts scale degrees across octaves", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7].map(degreeSemitones)).toEqual([0, 2, 4, 5, 7, 9, 11, 12]);
    expect(degreeSemitones(-1)).toBe(-1);
    expect(degreeSemitones(-3)).toBe(-5);
  });

  it("builds diatonic chords", () => {
    expect(chordPitchClasses("C", { degree: 0 })).toEqual([0, 4, 7]);
    expect(chordPitchClasses("C", { degree: 5 })).toEqual([9, 0, 4]);
    expect(chordPitchClasses("C", { degree: 4, seventh: true })).toEqual([7, 11, 2, 5]);
    expect(chordPitchClasses("D", { degree: 1 })).toEqual([4, 7, 11]);
    expect(chordInterval(5, 2)).toBe(3);
    expect(chordInterval(0, 2)).toBe(4);
  });

  it("places melody roots within a tritone of home", () => {
    for (let degree = 0; degree < 7; degree += 1) {
      const root = relativePitch("C", degree, 0, 74);
      expect(root).toBeGreaterThanOrEqual(67);
      expect(root).toBeLessThanOrEqual(78);
    }
    expect(relativePitch("C", 0, 2, 74)).toBe(76);
    expect(relativePitch("C", 5, 7, 74)).toBe(81);
  });

  it("voices chords close together and moves little between them", () => {
    const first = voiceChord("C", { degree: 0 }, null, 64);
    expect(Math.max(...first) - Math.min(...first)).toBeLessThanOrEqual(12);
    const next = voiceChord("C", { degree: 4 }, first, 64);
    const movement = next.reduce((sum, note) => sum + Math.min(...first.map((old) => Math.abs(old - note))), 0);
    expect(movement).toBeLessThanOrEqual(6);
    expect(next.map((note) => note % 12).sort((a, b) => a - b)).toEqual([2, 7, 11]);
  });
});
