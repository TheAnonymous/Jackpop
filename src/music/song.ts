import type { ReelId } from "./reels";
import { REELS } from "./reels";

/*
 * How a loop becomes a song. Sections play the same four-bar loop underneath
 * (their lengths are whole loops), but decide which reels sound and how:
 * a lighter beat in the verse, the hook chopped up in the drop, the last
 * chorus a whole tone higher, a fade at the end.
 */

export type SectionName = "loop" | "intro" | "verse" | "chorus" | "drop" | "lift" | "outro";

export interface Section {
  name: SectionName;
  label: string;
  /** Length in bars, a multiple of the four-bar loop. */
  bars: number;
  parts: readonly ReelId[];
  /** Whether the coin-slot voice sings here. */
  voice: boolean;
  /** Whether the glitter arpeggios play here. */
  sparkle: boolean;
  /** Semitones up: the pop key change. */
  transpose: number;
  /** The hook as stuttered chops instead of its melody. */
  chop: boolean;
  beat: "light" | "normal" | "full";
  /** A riser and a snare roll in the last bar, into the next section. */
  build: boolean;
  /** Everything fades out over the section. */
  fade: boolean;
  /** A crash on the first beat. */
  crash: boolean;
}

type Options = Partial<Omit<Section, "name" | "label" | "bars" | "parts">>;

function section(name: SectionName, label: string, bars: number, parts: readonly ReelId[], options: Options = {}): Section {
  return { name, label, bars, parts, voice: false, sparkle: false, transpose: 0, chop: false, beat: "normal", build: false, fade: false, crash: false, ...options };
}

export const LOOP_SECTION = section("loop", "Loop", 4, REELS, { voice: true, sparkle: true });

/** About a minute at 150 BPM: short enough to send to a friend. */
export const SONG: readonly Section[] = [
  section("intro", "Intro", 4, ["chords"], { sparkle: true }),
  section("verse", "Strophe", 8, ["beat", "bass", "chords"], { beat: "light", build: true }),
  section("chorus", "Refrain", 8, REELS, { voice: true, sparkle: true, crash: true }),
  section("drop", "Drop", 4, ["beat", "bass", "hook"], { chop: true, beat: "full", crash: true, build: true }),
  section("lift", "Refrain ↑", 8, REELS, { voice: true, sparkle: true, transpose: 2, crash: true }),
  section("outro", "Outro", 4, ["chords", "hook"], { sparkle: true, fade: true }),
];

/** Where a jackpot pull jumps in the song: straight into the drop. */
export const SONG_DROP = SONG.findIndex((part) => part.name === "drop");

/** A jackpot's reward in loop mode: a bonus drop, then one round a whole tone higher. */
export const BONUS: readonly Section[] = [
  section("drop", "Bonus-Drop", 4, ["beat", "bass", "hook"], { chop: true, beat: "full", crash: true, build: true }),
  section("lift", "Rückung", 4, REELS, { voice: true, sparkle: true, transpose: 2, crash: true }),
];

export const SONG_BARS = SONG.reduce((sum, part) => sum + part.bars, 0);

export function songSeconds(tempo: number): number {
  return (SONG_BARS * 4 * 60) / tempo;
}
