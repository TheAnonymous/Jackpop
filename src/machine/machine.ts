import type { ReelSetting } from "../music/loop";
import { STEPS_PER_BAR } from "../music/loop";
import type { Family, ReelId } from "../music/reels";
import { REELS, STRIP_LENGTH, variantAt } from "../music/reels";

/*
 * The rules of the slot machine, free of sound and screen: where the reels
 * land, when they stop, and what counts as a jackpot.
 */

export interface Jackpot {
  family: Family;
  count: number;
  reels: ReelId[];
}

export function wrap(position: number): number {
  return ((Math.round(position) % STRIP_LENGTH) + STRIP_LENGTH) % STRIP_LENGTH;
}

/** New stops for every reel that is not held. Pulling costs nothing, so no reel is ever rigged. */
export function spinPositions(reels: Record<ReelId, ReelSetting>, random: () => number): Record<ReelId, number> {
  return Object.fromEntries(REELS.map((reel) => [
    reel,
    reels[reel].held ? reels[reel].position : Math.floor(random() * STRIP_LENGTH) % STRIP_LENGTH,
  ])) as Record<ReelId, number>;
}

/** Three or four reels of one family on the line. */
export function detectJackpot(positions: Record<ReelId, number>): Jackpot | null {
  const byFamily = new Map<Family, ReelId[]>();
  for (const reel of REELS) {
    const family = variantAt(reel, positions[reel]).family;
    byFamily.set(family, [...(byFamily.get(family) ?? []), reel]);
  }
  let best: Jackpot | null = null;
  for (const [family, reels] of byFamily) {
    if (reels.length >= 3 && (!best || reels.length > best.count)) best = { family, count: reels.length, reels };
  }
  return best;
}

export interface StopPlan {
  /** Absolute sixteenth at which each spinning reel stops. */
  stops: Partial<Record<ReelId, number>>;
  /** Absolute sixteenth at which the loop starts again from the top, or `null` when only one reel spins alone. */
  restart: number | null;
}

/**
 * When the reels of a pull stop: as a fill of eighths in the second half of
 * a bar (beat, chords, hook, bass: da-da-da-da), then the loop drops back in
 * from its first bar on the next downbeat. The reels spin at least a quarter
 * note first; a full pull spins a bar longer.
 */
export function planPull(nextStep: number, loopStep: number, strength: number, spinning: readonly ReelId[]): StopPlan {
  const half = STEPS_PER_BAR / 2;
  let distance = (half - (loopStep % STEPS_PER_BAR) + STEPS_PER_BAR) % STEPS_PER_BAR;
  if (distance < 4) distance += STEPS_PER_BAR;
  if (strength >= 0.8) distance += STEPS_PER_BAR;
  const fillStart = nextStep + distance;
  const stops: Partial<Record<ReelId, number>> = {};
  REELS.forEach((reel, index) => {
    if (spinning.includes(reel)) stops[reel] = fillStart + index * 2;
  });
  return { stops, restart: fillStart + half };
}

/** One reel spun on its own stops on the beat after next and carries on playing from there. */
export function planSingle(nextStep: number, loopStep: number, reel: ReelId): StopPlan {
  let distance = (4 - (loopStep % 4)) % 4;
  if (distance < 2) distance += 4;
  return { stops: { [reel]: nextStep + distance + 4 }, restart: null };
}
