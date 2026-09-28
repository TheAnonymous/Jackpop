import type { ReelId } from "../music/reels";

/*
 * Lets the automated tests decide where the next pull lands (a jackpot on
 * demand). Only the local test API ever sets it.
 */
let forced: Partial<Record<ReelId, number>> | null = null;

export function forceNextSpin(positions: Partial<Record<ReelId, number>>): void {
  forced = positions;
}

export function takeForcedSpin(): Partial<Record<ReelId, number>> | null {
  const next = forced;
  forced = null;
  return next;
}
