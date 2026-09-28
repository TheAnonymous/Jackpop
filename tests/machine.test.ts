import { describe, expect, it } from "vitest";
import { detectJackpot, planPull, planSingle, spinPositions, wrap } from "../src/machine/machine";
import type { ReelSetting } from "../src/music/loop";
import { REELS, STRIPS, type ReelId } from "../src/music/reels";

const setting = (position: number, held = false): ReelSetting => ({ position, held, sound: null, shift: 0 });
const index = (reel: ReelId, id: string) => STRIPS[reel].indexOf(`${reel}.${id}`);

function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 4_294_967_296;
  };
}

describe("machine", () => {
  it("wraps positions around the strip", () => {
    expect(wrap(12)).toBe(0);
    expect(wrap(-1)).toBe(11);
  });

  it("spins every reel that is not held", () => {
    const reels = { beat: setting(3, true), chords: setting(4), hook: setting(5, true), bass: setting(6) };
    for (let run = 0; run < 50; run += 1) {
      const positions = spinPositions(reels, seeded(run));
      expect(positions.beat).toBe(3);
      expect(positions.hook).toBe(5);
      for (const reel of REELS) expect(positions[reel]).toBeGreaterThanOrEqual(0);
    }
  });

  it("finds three or four of a family on the line", () => {
    expect(detectJackpot({ beat: index("beat", "sweet.a"), chords: index("chords", "sweet.b"), hook: index("hook", "sweet.a"), bass: index("bass", "club.a") }))
      .toEqual({ family: "sweet", count: 3, reels: ["beat", "chords", "hook"] });
    expect(detectJackpot({ beat: index("beat", "wild.a"), chords: index("chords", "wild.b"), hook: index("hook", "wild.a"), bass: index("bass", "wild.b") })?.count).toBe(4);
    expect(detectJackpot({ beat: index("beat", "wild.a"), chords: index("chords", "sweet.b"), hook: index("hook", "wild.a"), bass: index("bass", "club.a") })).toBeNull();
  });

  it("pays out about every tenth pull without holding", () => {
    const random = seeded(7);
    const reels = Object.fromEntries(REELS.map((reel) => [reel, setting(0)])) as Record<ReelId, ReelSetting>;
    let jackpots = 0;
    const pulls = 20_000;
    for (let pull = 0; pull < pulls; pull += 1) if (detectJackpot(spinPositions(reels, random))) jackpots += 1;
    expect(jackpots / pulls).toBeGreaterThan(0.08);
    expect(jackpots / pulls).toBeLessThan(0.115);
  });

  it("stops the reels as a fill of eighths before the next downbeat and drops back in on it", () => {
    expect(planPull(100, 0, 0.5, REELS)).toEqual({ stops: { beat: 108, chords: 110, hook: 112, bass: 114 }, restart: 116 });
    expect(planPull(100, 5, 0.5, REELS)).toEqual({ stops: { beat: 119, chords: 121, hook: 123, bass: 125 }, restart: 127 });
    expect(planPull(100, 2, 0.5, REELS).restart).toBe(114);
    expect(planPull(100, 12, 0.5, ["hook"]).stops).toEqual({ hook: 116 });
    expect(planPull(100, 0, 1, REELS).restart).toBe(132);
    // The loop always drops back in on a downbeat of the old bar grid.
    for (let loopStep = 0; loopStep < 64; loopStep += 1) {
      const plan = planPull(1000, loopStep, 0.5, REELS);
      expect((loopStep + plan.restart! - 1000) % 16, `loop step ${loopStep}`).toBe(0);
      expect(plan.stops.beat! - 1000, `loop step ${loopStep}`).toBeGreaterThanOrEqual(4);
    }
  });

  it("lets a single reel land two beats later without restarting the loop", () => {
    expect(planSingle(10, 3, "bass")).toEqual({ stops: { bass: 19 }, restart: null });
    expect(planSingle(10, 0, "bass")).toEqual({ stops: { bass: 18 }, restart: null });
  });
});
