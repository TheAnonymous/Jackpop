import { describe, expect, it } from "vitest";
import { buildLoop, LOOP_STEPS, type ReelSetting } from "../src/music/loop";
import { allVariants, FAMILIES, REELS, STRIP_LENGTH, STRIPS, variantAt, type ReelId } from "../src/music/reels";
import { KEY_NAMES, keyRoot } from "../src/music/theory";

const setting = (position: number, shift = 0): ReelSetting => ({ position, held: false, sound: null, shift });
const allAt = (positions: Record<ReelId, number>, shift = 0) => Object.fromEntries(REELS.map((reel) => [reel, setting(positions[reel], shift)])) as Record<ReelId, ReelSetting>;
const MAJOR = [0, 2, 4, 5, 7, 9, 11];

describe("reel strips", () => {
  it("carry twelve symbols of their own reel, each family twice", () => {
    for (const reel of REELS) {
      expect(STRIPS[reel]).toHaveLength(STRIP_LENGTH);
      expect(new Set(STRIPS[reel]).size).toBe(STRIP_LENGTH);
      const families = Array.from({ length: STRIP_LENGTH }, (_, index) => variantAt(reel, index).family);
      for (const family of FAMILIES) expect(families.filter((entry) => entry === family), `${reel} ${family}`).toHaveLength(2);
      for (let index = 0; index < STRIP_LENGTH; index += 1) expect(variantAt(reel, index).reel).toBe(reel);
    }
    expect(allVariants()).toHaveLength(48);
  });

  it("have drum bars of sixteen steps and melodies inside the bar", () => {
    for (const variant of allVariants()) {
      if (variant.reel === "beat") {
        for (const bar of [variant.bar, variant.fill]) for (const pattern of Object.values(bar)) expect(pattern, variant.id).toMatch(/^[.oxX234]{16}$/);
      } else if (variant.reel !== "chords") {
        for (const bar of variant.bars) for (const note of bar) {
          expect(note.step + note.len, variant.id).toBeLessThanOrEqual(16);
          expect(note.len, variant.id).toBeGreaterThan(0);
        }
      }
    }
  });
});

describe("buildLoop", () => {
  it("keeps every note of every combination in the key and in a sensible range", () => {
    for (const key of ["C", "F#", "A#"] as const) {
      for (let index = 0; index < STRIP_LENGTH; index += 1) {
        const positions = { beat: index, chords: (index * 5) % 12, hook: (index * 7) % 12, bass: (index * 11) % 12 };
        const loop = buildLoop(key, allAt(positions));
        const inKey = (pitch: number) => MAJOR.includes((((pitch - keyRoot(key)) % 12) + 12) % 12);
        for (let step = 0; step < LOOP_STEPS; step += 1) {
          for (const hit of loop.chords[step]!) for (const pitch of hit.pitches) {
            expect(inKey(pitch)).toBe(true);
            expect(pitch).toBeGreaterThanOrEqual(48);
            expect(pitch).toBeLessThanOrEqual(84);
          }
          for (const note of loop.hook[step]!) {
            expect(inKey(note.pitch)).toBe(true);
            expect(note.pitch).toBeGreaterThanOrEqual(57);
            expect(note.pitch).toBeLessThanOrEqual(96);
          }
          for (const note of loop.bass[step]!) {
            expect(inKey(note.pitch)).toBe(true);
            expect(note.pitch).toBeGreaterThanOrEqual(24);
            expect(note.pitch).toBeLessThanOrEqual(60);
          }
        }
      }
    }
  });

  it("puts a kick on the first step of every beat and gives every part notes", () => {
    for (let index = 0; index < STRIP_LENGTH; index += 1) {
      const loop = buildLoop("C", allAt({ beat: index, chords: index, hook: index, bass: index }));
      expect(loop.beat[0]!.some((hit) => hit.voice === "kick")).toBe(true);
      for (const part of [loop.chords, loop.hook, loop.bass]) expect(part.flat().length).toBeGreaterThan(0);
      expect(loop.harmony).toHaveLength(4);
    }
  });

  it("moves the melodic parts by octaves and thins or fills the beat", () => {
    const positions = { beat: 0, chords: 0, hook: 0, bass: 0 };
    const plain = buildLoop("C", allAt(positions));
    const up = buildLoop("C", allAt(positions, 1));
    const firstHook = (loop: typeof plain) => loop.hook.flat()[0]!.pitch;
    expect(firstHook(up) - firstHook(plain)).toBe(12);
    const light = buildLoop("C", { ...allAt(positions), beat: setting(0, -1) });
    const voices = (loop: typeof plain) => new Set(loop.beat.flat().map((hit) => hit.voice));
    expect(voices(light).has("hat")).toBe(false);
    expect(voices(light).has("kick")).toBe(true);
  });

  it("uses a chosen sound instead of the symbol's own", () => {
    const reels = allAt({ beat: 0, chords: 0, hook: 0, bass: 0 });
    reels.hook.sound = "flute";
    reels.beat.sound = "not-a-kit";
    const loop = buildLoop("C", reels);
    expect(loop.hookSound).toBe("flute");
    expect(loop.kit).toBe(variantAt("beat", 0).reel === "beat" ? "bubble" : "");
  });

  it("works in every key", () => {
    for (const key of KEY_NAMES) expect(() => buildLoop(key, allAt({ beat: 1, chords: 2, hook: 3, bass: 4 }))).not.toThrow();
  });
});
