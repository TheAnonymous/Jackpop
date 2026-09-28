import { describe, expect, it } from "vitest";
import { detectJackpot, giveInChance, GIVES_IN_AFTER, moodOf, planPull, planSingle, spinPositions, tipIntoJackpot, wrap } from "../src/machine/machine";
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
  it("wraps positions around the strip, with or without its diamond", () => {
    expect(wrap(12)).toBe(0);
    expect(wrap(-1)).toBe(11);
    expect(wrap(12, 13)).toBe(12);
    expect(wrap(-1, 13)).toBe(12);
  });

  it("only lands on a diamond once it is unlocked", () => {
    const reels = Object.fromEntries(REELS.map((reel) => [reel, setting(0)])) as Record<ReelId, ReelSetting>;
    const random = seeded(3);
    const seen = new Set<number>();
    for (let pull = 0; pull < 400; pull += 1) seen.add(spinPositions(reels, random).beat);
    expect(seen.has(12)).toBe(false);
    for (let pull = 0; pull < 400; pull += 1) seen.add(spinPositions(reels, random, { beat: 13, chords: 12, hook: 12, bass: 12 }).beat);
    expect(seen.has(12)).toBe(true);
  });

  it("counts diamonds as jokers", () => {
    const diamond = 12;
    expect(detectJackpot({ beat: diamond, chords: index("chords", "sweet.a"), hook: index("hook", "sweet.b"), bass: index("bass", "club.a") }))
      .toEqual({ family: "sweet", count: 3, reels: ["beat", "chords", "hook"], jokers: 1 });
    expect(detectJackpot({ beat: diamond, chords: diamond, hook: index("hook", "wild.a"), bass: index("bass", "club.a") })?.count).toBe(3);
    expect(detectJackpot({ beat: diamond, chords: diamond, hook: diamond, bass: diamond })).toEqual({ family: "rare", count: 4, reels: [...REELS], jokers: 0 });
    expect(detectJackpot({ beat: diamond, chords: index("chords", "wild.a"), hook: index("hook", "sweet.a"), bass: index("bass", "club.a") })).toBeNull();
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
      .toEqual({ family: "sweet", count: 3, reels: ["beat", "chords", "hook"], jokers: 0 });
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

describe("the machine's mood", () => {
  const lengths = { beat: 12, chords: 12, hook: 12, bass: 12 };

  it("goes from happy to impatient to hot as pulls stay dry", () => {
    expect([0, 4, 5, 9, 10, 20].map(moodOf)).toEqual(["happy", "happy", "impatient", "impatient", "hot", "hot"]);
  });

  it("gives in more and more often, and always on the fourteenth dry pull", () => {
    expect(giveInChance(0)).toBe(0);
    expect(giveInChance(4)).toBe(0);
    const chances = Array.from({ length: GIVES_IN_AFTER }, (_, dry) => giveInChance(dry));
    for (let dry = 1; dry < chances.length; dry += 1) expect(chances[dry]!).toBeGreaterThanOrEqual(chances[dry - 1]!);
    expect(giveInChance(GIVES_IN_AFTER - 1)).toBe(1);
  });

  it("tips a line into a jackpot by moving as few free reels as it can", () => {
    const reels = Object.fromEntries(REELS.map((reel) => [reel, setting(0)])) as Record<ReelId, ReelSetting>;
    const landed = { beat: index("beat", "sweet.a"), chords: index("chords", "sweet.b"), hook: index("hook", "wild.a"), bass: index("bass", "club.a") };
    for (let run = 0; run < 30; run += 1) {
      const tipped = tipIntoJackpot(landed, reels, lengths, seeded(run))!;
      const jackpot = detectJackpot(tipped)!;
      expect(jackpot.family).toBe("sweet");
      const moved = REELS.filter((reel) => tipped[reel] !== landed[reel]);
      expect(moved).toHaveLength(1);
    }
  });

  it("never moves a held reel, and gives up when holds make it impossible", () => {
    const held = { beat: setting(index("beat", "sweet.a"), true), chords: setting(index("chords", "wild.a"), true), hook: setting(index("hook", "club.a"), true), bass: setting(0) };
    const landed = { beat: held.beat.position, chords: held.chords.position, hook: held.hook.position, bass: index("bass", "anthem.a") };
    expect(tipIntoJackpot(landed, held, lengths, seeded(1))).toBeNull();
    const twoHeld = { ...held, hook: setting(index("hook", "dreamy.a")) };
    const tipped = tipIntoJackpot({ ...landed, hook: twoHeld.hook.position }, twoHeld, lengths, seeded(2))!;
    expect(tipped.beat).toBe(held.beat.position);
    expect(tipped.chords).toBe(held.chords.position);
    expect(detectJackpot(tipped)?.count).toBe(3);
  });
});
