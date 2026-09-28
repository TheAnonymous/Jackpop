/*
 * Harmony for the hit machine. Everything is diatonic to one major key, and
 * melodies are written relative to the chord of their bar, so any hook and
 * any bass line fit any chord progression: the reels always sound together.
 */

export const KEY_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;
export type KeyName = (typeof KEY_NAMES)[number];

const MAJOR = [0, 2, 4, 5, 7, 9, 11] as const;

/** A chord on a scale degree of the key: 0 = I, 1 = ii … 5 = vi. */
export interface ChordSpec {
  degree: number;
  seventh?: boolean;
  add9?: boolean;
}

export function keyRoot(key: KeyName): number {
  return KEY_NAMES.indexOf(key);
}

/** Semitones from the key root to a scale degree; degrees below 0 or above 6 reach other octaves. */
export function degreeSemitones(degree: number): number {
  const octave = Math.floor(degree / 7);
  return octave * 12 + MAJOR[((degree % 7) + 7) % 7]!;
}

/** Semitones from a chord's root to a tone counted in scale steps from that root (2 = third, 4 = fifth, 7 = octave). */
export function chordInterval(chordDegree: number, tone: number): number {
  return degreeSemitones(chordDegree + tone) - degreeSemitones(chordDegree);
}

/** The chord's tones as scale steps from its root. */
export function chordTones(chord: ChordSpec): number[] {
  const tones = [0, 2, 4];
  if (chord.seventh) tones.push(6);
  if (chord.add9) tones.push(8);
  return tones;
}

function pitchClass(pitch: number): number {
  return ((pitch % 12) + 12) % 12;
}

/**
 * The pitch of a chord-relative tone. The chord root sits in the octave
 * [home - 7, home + 4], so a melody keeps its shape within a bar while its
 * register moves by at most a tritone from chord to chord.
 */
export function relativePitch(key: KeyName, chordDegree: number, tone: number, home: number): number {
  const rootClass = pitchClass(keyRoot(key) + degreeSemitones(chordDegree));
  const low = home - 7;
  const root = low + pitchClass(rootClass - low);
  return root + chordInterval(chordDegree, tone);
}

/** Pitch classes of a chord in the key, root first. */
export function chordPitchClasses(key: KeyName, chord: ChordSpec): number[] {
  const root = keyRoot(key) + degreeSemitones(chord.degree);
  return chordTones(chord).map((tone) => pitchClass(root + chordInterval(chord.degree, tone)));
}

/**
 * A close voicing of the chord near `center`, moving as little as possible
 * from the previous voicing, like a keyboard player's hands would.
 */
export function voiceChord(key: KeyName, chord: ChordSpec, previous: readonly number[] | null, center = 64): number[] {
  const classes = chordPitchClasses(key, chord);
  const candidates: number[][] = [];
  for (let inversion = 0; inversion < classes.length; inversion += 1) {
    const order = [...classes.slice(inversion), ...classes.slice(0, inversion)];
    for (const start of [center - 12, center - 6, center]) {
      const voicing: number[] = [];
      let pitch = start + pitchClass(order[0]! - start);
      for (const pc of order) {
        while (pitchClass(pitch) !== pc) pitch += 1;
        voicing.push(pitch);
        pitch += 1;
      }
      candidates.push(voicing);
    }
  }
  const mean = (notes: readonly number[]) => notes.reduce((sum, note) => sum + note, 0) / notes.length;
  const score = (voicing: number[]) => {
    const drift = Math.abs(mean(voicing) - center);
    if (!previous || previous.length === 0) return drift;
    const movement = voicing.reduce((sum, note) => sum + Math.min(...previous.map((old) => Math.abs(old - note))), 0);
    return movement + drift * 0.35;
  };
  return candidates.reduce((best, candidate) => (score(candidate) < score(best) ? candidate : best));
}

export function midiToHz(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}
