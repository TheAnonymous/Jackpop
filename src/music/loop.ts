import type { BassSound, ChordRhythm, ChordSound, DrumBar, DrumVoice, Family, HookSound, Kit, MelodyVariant, NoteEvent, ReelId } from "./reels";
import { DRUM_VOICES, REELS, soundsFor, variantAt } from "./reels";
import type { KeyName } from "./theory";
import { relativePitch, voiceChord } from "./theory";

/*
 * Turns the machine's reel positions into concrete notes for one four-bar
 * loop of sixteenths. The engine only reads these arrays, step by step.
 */

export const STEPS_PER_BAR = 16;
export const LOOP_BARS = 4;
export const LOOP_STEPS = STEPS_PER_BAR * LOOP_BARS;

/** Octave homes of the melodic parts (MIDI); a reel's "Lage" moves them by octaves. */
const HOOK_HOME = 74;
const BASS_HOME = 43;
const CHORD_CENTER = 64;

export interface ReelSetting {
  position: number;
  held: boolean;
  /** Chosen sound, or `null` for the symbol's own. */
  sound: string | null;
  /** Octave for chords, hook and bass; density for the beat. −1, 0 or 1. */
  shift: number;
}

export interface DrumHit {
  voice: DrumVoice;
  vel: number;
  ratchet: number;
}

export interface ToneNote {
  pitch: number;
  /** Length in sixteenths. */
  len: number;
  vel: number;
  glide: boolean;
}

export interface ChordHit {
  pitches: number[];
  len: number;
  vel: number;
}

export interface LoopData {
  kit: Kit;
  chordSound: ChordSound;
  hookSound: HookSound;
  bassSound: BassSound;
  /** One entry per sixteenth of the loop. */
  beat: DrumHit[][];
  chords: ChordHit[][];
  hook: ToneNote[][];
  bass: ToneNote[][];
  /** The glitter layer: bell arpeggios over the chords, thinned out by the Glitzer knob. */
  sparkle: ToneNote[][];
  /** Per bar: the chord voicing and the bass root, for the machine's stop hits and jingles. */
  harmony: { voicing: number[]; bassRoot: number }[];
  families: Record<ReelId, Family>;
}

const emptySteps = <T>() => Array.from({ length: LOOP_STEPS }, () => [] as T[]);

function drumSymbol(symbol: string): { vel: number; ratchet: number } | null {
  switch (symbol) {
    case "o": return { vel: 0.45, ratchet: 1 };
    case "x": return { vel: 0.78, ratchet: 1 };
    case "X": return { vel: 1, ratchet: 1 };
    case "2": case "3": case "4": return { vel: 0.7, ratchet: Number(symbol) };
    default: return null;
  }
}

function densify(bar: DrumBar, shift: number): DrumBar {
  if (shift < 0) {
    // Lighter: only the backbone of kick, snare, clap and tom.
    const backbone: DrumVoice[] = ["kick", "snare", "clap", "tom"];
    return Object.fromEntries(Object.entries(bar).filter(([voice]) => backbone.includes(voice as DrumVoice)));
  }
  if (shift > 0) {
    return { ...bar, shaker: bar.shaker ?? "oxoxoxoxoxoxoxox", openhat: bar.openhat ?? "..............x." };
  }
  return bar;
}

const CHORD_RHYTHMS: Record<Exclude<ChordRhythm, "arp">, [step: number, len: number, vel: number][]> = {
  bounce: [[2, 1, 0.8], [6, 1, 0.75], [10, 1, 0.8], [14, 1, 0.75]],
  sync: [[0, 3, 0.9], [3, 3, 0.75], [6, 2, 0.75], [8, 3, 0.85], [11, 3, 0.75], [14, 2, 0.75]],
  pulse: Array.from({ length: 8 }, (_, index) => [index * 2, 1, index % 2 === 0 ? 0.85 : 0.68] as [number, number, number]),
  stab: [[0, 2, 0.95], [6, 2, 0.8], [10, 1, 0.75], [12, 2, 0.85]],
  pad: [[0, 16, 0.8]],
};

function arpeggio(voicing: readonly number[]): number[] {
  const up = [...voicing].sort((a, b) => a - b);
  const down = up.slice(1, -1).reverse();
  return [...up, ...down];
}

function melody(variant: MelodyVariant, bar: number): NoteEvent[] {
  return variant.bars[bar % variant.bars.length] ?? [];
}

function pick<T extends string>(options: readonly T[], chosen: string | null, fallback: T): T {
  return chosen !== null && options.includes(chosen as T) ? (chosen as T) : fallback;
}

export function buildLoop(key: KeyName, reels: Record<ReelId, ReelSetting>): LoopData {
  const beatVariant = variantAt("beat", reels.beat.position);
  const chordVariant = variantAt("chords", reels.chords.position);
  const hookVariant = variantAt("hook", reels.hook.position);
  const bassVariant = variantAt("bass", reels.bass.position);
  if (beatVariant.reel !== "beat" || chordVariant.reel !== "chords" || hookVariant.reel !== "hook" || bassVariant.reel !== "bass") {
    throw new Error("reel strip holds a variant of another reel");
  }

  const loop: LoopData = {
    kit: pick(soundsFor("beat") as readonly Kit[], reels.beat.sound, beatVariant.kit),
    chordSound: pick(soundsFor("chords") as readonly ChordSound[], reels.chords.sound, chordVariant.sound),
    hookSound: pick(soundsFor("hook") as readonly HookSound[], reels.hook.sound, hookVariant.sound as HookSound),
    bassSound: pick(soundsFor("bass") as readonly BassSound[], reels.bass.sound, bassVariant.sound as BassSound),
    beat: emptySteps(),
    chords: emptySteps(),
    hook: emptySteps(),
    bass: emptySteps(),
    sparkle: emptySteps(),
    harmony: [],
    families: Object.fromEntries(REELS.map((reel) => [reel, variantAt(reel, reels[reel].position).family])) as Record<ReelId, Family>,
  };

  const clampShift = (shift: number) => Math.max(-1, Math.min(1, Math.round(shift)));
  let previousVoicing: number[] | null = null;
  for (let bar = 0; bar < LOOP_BARS; bar += 1) {
    const offset = bar * STEPS_PER_BAR;
    const chord = chordVariant.progression[bar]!;

    const drums = densify(bar === LOOP_BARS - 1 ? beatVariant.fill : beatVariant.bar, clampShift(reels.beat.shift));
    for (const voice of DRUM_VOICES) {
      const pattern = drums[voice];
      if (!pattern) continue;
      for (let step = 0; step < STEPS_PER_BAR; step += 1) {
        const hit = drumSymbol(pattern[step] ?? ".");
        if (hit) loop.beat[offset + step]!.push({ voice, ...hit });
      }
    }

    const voicing = voiceChord(key, chord, previousVoicing, CHORD_CENTER + 12 * clampShift(reels.chords.shift));
    previousVoicing = voicing;
    if (chordVariant.rhythm === "arp") {
      const tones = arpeggio(voicing);
      for (let step = 0; step < STEPS_PER_BAR; step += 1) {
        loop.chords[offset + step]!.push({ pitches: [tones[step % tones.length]!], len: 1, vel: step % 4 === 0 ? 0.85 : 0.62 });
      }
    } else {
      for (const [step, len, vel] of CHORD_RHYTHMS[chordVariant.rhythm]) loop.chords[offset + step]!.push({ pitches: voicing, len, vel });
    }

    const sparkleTones = arpeggio(voicing).map((pitch) => pitch + 24);
    for (let step = 0; step < STEPS_PER_BAR; step += 1) {
      loop.sparkle[offset + step]!.push({ pitch: sparkleTones[step % sparkleTones.length]!, len: 1, vel: step % 2 === 0 ? 0.7 : 0.45, glide: false });
    }

    const hookHome = HOOK_HOME + 12 * clampShift(reels.hook.shift);
    for (const event of melody(hookVariant, bar)) {
      const pitch = relativePitch(key, chord.degree, event.tone, hookHome);
      loop.hook[offset + event.step]!.push({ pitch, len: event.len, vel: event.step % 4 === 0 ? 0.95 : 0.8, glide: false });
    }

    const bassHome = BASS_HOME + 12 * clampShift(reels.bass.shift);
    for (const event of melody(bassVariant, bar)) {
      const pitch = relativePitch(key, chord.degree, event.tone, bassHome);
      loop.bass[offset + event.step]!.push({ pitch, len: event.len, vel: event.step % 4 === 0 ? 1 : 0.85, glide: event.glide === true });
    }

    loop.harmony.push({ voicing, bassRoot: relativePitch(key, chord.degree, 0, bassHome) });
  }
  return loop;
}

/** The first hook note of the loop, for the hook reel's stop hit. */
export function firstNote(steps: ToneNote[][]): ToneNote | null {
  for (const notes of steps) if (notes.length > 0) return notes[0]!;
  return null;
}
