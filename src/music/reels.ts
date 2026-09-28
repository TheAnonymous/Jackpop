import type { ChordSpec } from "./theory";

/*
 * What the reels carry. Each reel is a strip of twelve symbols plus a diamond
 * that jackpots unlock; every symbol is one variant of that reel's part and
 * belongs to a sound family. Hooks and
 * bass lines are written in scale steps from the chord root of their bar
 * (0 root, 2 third, 4 fifth, 7 octave), so every combination fits.
 */

export const REELS = ["beat", "chords", "hook", "bass"] as const;
export type ReelId = (typeof REELS)[number];

/** The six families every strip starts with; the diamond is unlocked by jackpots. */
export const FAMILIES = ["sweet", "sparkle", "wild", "dreamy", "club", "anthem"] as const;
export type BaseFamily = (typeof FAMILIES)[number];
export type Family = BaseFamily | "rare";

export const FAMILY_INFO: Record<Family, { symbol: string; label: string; color: string }> = {
  rare: { symbol: "Diamant", label: "selten, Joker", color: "#8ff0ff" },
  sweet: { symbol: "Herz", label: "süß", color: "#ff4fa3" },
  sparkle: { symbol: "Stern", label: "glitzernd", color: "#ffd23f" },
  wild: { symbol: "Blitz", label: "wild", color: "#2de2e6" },
  dreamy: { symbol: "Mond", label: "verträumt", color: "#b48cff" },
  club: { symbol: "Flamme", label: "Club", color: "#ff7a2f" },
  anthem: { symbol: "Krone", label: "Hymne", color: "#4d7cff" },
};

export const REEL_LABELS: Record<ReelId, string> = { beat: "Beat", chords: "Akkorde", hook: "Hook", bass: "Bass" };

export const DRUM_VOICES = ["kick", "snare", "clap", "hat", "openhat", "snap", "shaker", "tom"] as const;
export type DrumVoice = (typeof DRUM_VOICES)[number];

export const KITS = ["bubble", "hyper", "soft"] as const;
export const CHORD_SOUNDS = ["pluck", "bell", "supersaw", "epiano", "organ", "pad"] as const;
export const HOOK_SOUNDS = ["chip", "bell", "saw", "flute", "pluck"] as const;
export const BASS_SOUNDS = ["square", "sub", "808", "saw"] as const;
export type Kit = (typeof KITS)[number];
export type ChordSound = (typeof CHORD_SOUNDS)[number];
export type HookSound = (typeof HOOK_SOUNDS)[number];
export type BassSound = (typeof BASS_SOUNDS)[number];

export const SOUND_LABELS: Record<Kit | ChordSound | HookSound | BassSound, string> = {
  bubble: "Bubble", hyper: "Hyper", soft: "Weich",
  pluck: "Zupfer", bell: "Glocke", supersaw: "Supersaw", epiano: "E-Piano", organ: "Orgel", pad: "Fläche",
  chip: "Chip", saw: "Säge", flute: "Flöte",
  square: "Rechteck", sub: "Sub", 808: "808",
};

/** Sixteen characters per bar: `.` rest, `o` soft, `x` hit, `X` accent, `2`–`4` a fast roll of that many hits. */
export type DrumBar = Partial<Record<DrumVoice, string>>;

/** A note: sixteenth step in the bar, length in sixteenths, tone in scale steps from the chord root. */
export interface NoteEvent {
  step: number;
  len: number;
  tone: number;
  glide?: boolean;
}

export const CHORD_RHYTHMS = ["bounce", "sync", "pulse", "stab", "pad", "arp"] as const;
export type ChordRhythm = (typeof CHORD_RHYTHMS)[number];

interface VariantBase {
  id: string;
  family: Family;
  name: string;
}

export interface BeatVariant extends VariantBase {
  reel: "beat";
  kit: Kit;
  bar: DrumBar;
  /** Bar 4 of the loop, leading back to the top. */
  fill: DrumBar;
}

export interface ChordVariant extends VariantBase {
  reel: "chords";
  progression: [ChordSpec, ChordSpec, ChordSpec, ChordSpec];
  rhythm: ChordRhythm;
  sound: ChordSound;
}

export interface MelodyVariant extends VariantBase {
  reel: "hook" | "bass";
  /** One to four bars, repeated over the four-bar loop. */
  bars: NoteEvent[][];
  sound: HookSound | BassSound;
}

export type Variant = BeatVariant | ChordVariant | MelodyVariant;

type Tuple = [step: number, len: number, tone: number, glide?: "glide"];
const notes = (...tuples: Tuple[]): NoteEvent[] => tuples.map(([step, len, tone, glide]) => ({ step, len, tone, ...(glide ? { glide: true } : {}) }));
const chords = (...degrees: number[]): ChordSpec[] => degrees.map((degree) => ({ degree }));
const sevenths = (...degrees: number[]): ChordSpec[] => degrees.map((degree) => ({ degree, seventh: true }));
const nines = (...degrees: number[]): ChordSpec[] => degrees.map((degree) => ({ degree, add9: true }));
const four = (specs: ChordSpec[]) => specs as [ChordSpec, ChordSpec, ChordSpec, ChordSpec];

const BEATS: BeatVariant[] = [
  {
    id: "beat.sweet.a", reel: "beat", family: "sweet", name: "Kaugummi-Hüpfer", kit: "bubble",
    bar: { kick: "X...x...x...x...", clap: "....X.......X...", hat: "..x...x...x...x.", shaker: "xoxoxoxoxoxoxoxo" },
    fill: { kick: "X...x...x...x...", clap: "....X.......X.XX", hat: "..x...x...x...x.", shaker: "xoxoxoxoxoxo4444" },
  },
  {
    id: "beat.sweet.b", reel: "beat", family: "sweet", name: "Klatsch-Shuffle", kit: "bubble",
    bar: { kick: "X.....x...x.....", clap: "....X..x....X...", hat: "x.x.x.x.x.x.x.x.", snap: "..............x." },
    fill: { kick: "X.....x...x.....", clap: "....X..x....XxXX", hat: "x.x.x.x.x.x.x.x." },
  },
  {
    id: "beat.sparkle.a", reel: "beat", family: "sparkle", name: "Sternenstaub", kit: "soft",
    bar: { kick: "X.........x.....", snare: "........X.......", hat: "x.xxx.xxx.xxx.x3", snap: "....o.......o..." },
    fill: { kick: "X.........x.....", snare: "........X.......", hat: "x.xxx.xxx.x3x333", snap: "....o.......o..." },
  },
  {
    id: "beat.sparkle.b", reel: "beat", family: "sparkle", name: "Glöckchen-Groove", kit: "bubble",
    bar: { kick: "X..x......x.....", clap: "........X.......", hat: "xoxoxoxoxoxoxoxo", shaker: "..x...x...x...x." },
    fill: { kick: "X..x......x.....", clap: "........X.......", snare: "............xxXX", hat: "xoxoxoxoxoxo...." },
  },
  {
    id: "beat.wild.a", reel: "beat", family: "wild", name: "Hyper-Break", kit: "hyper",
    bar: { kick: "X..x..x...x..x..", snare: "....X.......X...", hat: "xxx3xxx3xxx3xx33" },
    fill: { kick: "X..x..x...x.....", snare: "....X...X.X.XXXX", hat: "xxx3xxx3xxx3...." },
  },
  {
    id: "beat.wild.b", reel: "beat", family: "wild", name: "Stotter-Kick", kit: "hyper",
    bar: { kick: "X.X...X.X.X...X.", clap: "....X.......X...", hat: "x.x3x.x3x.x3x.x3", openhat: "......o.......o." },
    fill: { kick: "X.X...X.X.X.2.44", clap: "....X.......X...", hat: "x.x3x.x3x.x3...." },
  },
  {
    id: "beat.dreamy.a", reel: "beat", family: "dreamy", name: "Wolken-Beat", kit: "soft",
    bar: { kick: "X.......x.x.....", snap: "....x.......x...", hat: "..o...o...o...o.", shaker: "o.o.o.o.o.o.o.o." },
    fill: { kick: "X.......x.x.....", snap: "....x.......x.xx", hat: "..o...o...o...o.", shaker: "o.o.o.o.o.o.o.o." },
  },
  {
    id: "beat.dreamy.b", reel: "beat", family: "dreamy", name: "Traumtänzer", kit: "soft",
    bar: { kick: "X......x..x.....", snare: "........x.......", hat: "o...o...o...o...", openhat: "..o.......o....." },
    fill: { kick: "X......x..x.....", snare: "........x.....xx", hat: "o...o...o...o..." },
  },
  {
    id: "beat.club.a", reel: "beat", family: "club", name: "Vier auf den Boden", kit: "bubble",
    bar: { kick: "X...X...X...X...", clap: "....X.......X...", hat: "xo.oxo.oxo.oxo.o", openhat: "..x...x...x...x." },
    fill: { kick: "X...X...X...X...", clap: "....X.......XxXX", hat: "xo.oxo.oxo.oxo.o", openhat: "..x...x...x....." },
  },
  {
    id: "beat.club.b", reel: "beat", family: "club", name: "Disco-Kugel", kit: "bubble",
    bar: { kick: "X...X...X...X...", snare: "....X.......X...", clap: "....x.......x...", hat: "xoxoxoxoxoxoxoxo", openhat: "..............x." },
    fill: { kick: "X...X...X...X...", snare: "....X......xXxXX", clap: "....x.......x...", hat: "xoxoxoxoxoxo...." },
  },
  {
    id: "beat.anthem.a", reel: "beat", family: "anthem", name: "Stampf-Klatsch", kit: "bubble",
    bar: { kick: "X.X.....X.X.....", clap: "....X.......X..." },
    fill: { kick: "X.X.....X.X.....", clap: "....X.......X...", tom: "........X.x.x.X." },
  },
  {
    id: "beat.anthem.b", reel: "beat", family: "anthem", name: "Stadion-Marsch", kit: "hyper",
    bar: { kick: "X...X...X...X...", snare: "....X.......X...", clap: "....X.......X...", hat: "x.x.x.x.x.x.x.x." },
    fill: { kick: "X...X...X...X...", snare: "....X.......XXXX", tom: "........XxXx....", hat: "x.x.x.x........." },
  },
];

const CHORD_VARIANTS: ChordVariant[] = [
  { id: "chords.sweet.a", reel: "chords", family: "sweet", name: "Sonnenschein", progression: four(chords(0, 4, 5, 3)), rhythm: "bounce", sound: "pluck" },
  { id: "chords.sweet.b", reel: "chords", family: "sweet", name: "Milchshake", progression: four(chords(0, 5, 3, 4)), rhythm: "sync", sound: "epiano" },
  { id: "chords.sparkle.a", reel: "chords", family: "sparkle", name: "Königsweg", progression: four(sevenths(3, 4, 2, 5)), rhythm: "arp", sound: "bell" },
  { id: "chords.sparkle.b", reel: "chords", family: "sparkle", name: "Kristall", progression: four(nines(0, 2, 5, 3)), rhythm: "sync", sound: "epiano" },
  { id: "chords.wild.a", reel: "chords", family: "wild", name: "Überdreht", progression: four(chords(5, 3, 0, 4)), rhythm: "stab", sound: "supersaw" },
  { id: "chords.wild.b", reel: "chords", family: "wild", name: "Zuckerschock", progression: four(chords(5, 4, 3, 4)), rhythm: "pulse", sound: "supersaw" },
  { id: "chords.dreamy.a", reel: "chords", family: "dreamy", name: "Treppe runter", progression: four(sevenths(3, 2, 1, 0)), rhythm: "pad", sound: "pad" },
  { id: "chords.dreamy.b", reel: "chords", family: "dreamy", name: "Nachtfalter", progression: four(sevenths(5, 2, 3, 0)), rhythm: "pad", sound: "epiano" },
  { id: "chords.club.a", reel: "chords", family: "club", name: "Orgel-Stich", progression: four(chords(5, 3, 4, 0)), rhythm: "sync", sound: "organ" },
  { id: "chords.club.b", reel: "chords", family: "club", name: "House-Piano", progression: four(sevenths(1, 4, 0, 5)), rhythm: "sync", sound: "epiano" },
  { id: "chords.anthem.a", reel: "chords", family: "anthem", name: "Feuerzeug", progression: four(chords(3, 0, 4, 5)), rhythm: "pad", sound: "supersaw" },
  { id: "chords.anthem.b", reel: "chords", family: "anthem", name: "Stadionlicht", progression: four(chords(0, 4, 5, 2)), rhythm: "pulse", sound: "supersaw" },
];

const HOOKS: MelodyVariant[] = [
  {
    id: "hook.sweet.a", reel: "hook", family: "sweet", name: "Kaugummi-Hook", sound: "chip",
    bars: [
      notes([0, 2, 4], [2, 2, 4], [4, 2, 2], [6, 2, 4], [8, 3, 7], [11, 1, 4], [12, 4, 2]),
      notes([0, 2, 4], [2, 2, 4], [4, 2, 2], [6, 2, 4], [8, 3, 7], [11, 1, 4], [12, 4, 2]),
      notes([0, 2, 4], [2, 2, 4], [4, 2, 2], [6, 2, 4], [8, 3, 7], [11, 1, 4], [12, 4, 2]),
      notes([0, 2, 4], [2, 2, 4], [4, 2, 5], [6, 2, 4], [8, 6, 2], [14, 2, 1]),
    ],
  },
  {
    id: "hook.sweet.b", reel: "hook", family: "sweet", name: "La-la-la", sound: "pluck",
    bars: [
      notes([0, 1, 0], [2, 1, 2], [4, 2, 4], [6, 2, 2], [8, 1, 4], [10, 1, 5], [12, 4, 4]),
      notes([0, 1, 7], [2, 1, 5], [4, 2, 4], [6, 2, 2], [8, 6, 0], [14, 2, -1]),
    ],
  },
  {
    id: "hook.sparkle.a", reel: "hook", family: "sparkle", name: "Sternschnuppe", sound: "bell",
    bars: [
      notes([0, 1, 0], [1, 1, 2], [2, 1, 4], [3, 1, 7], [4, 4, 9], [8, 1, 7], [9, 1, 4], [10, 2, 2], [12, 4, 4]),
      notes([0, 1, 0], [1, 1, 2], [2, 1, 4], [3, 1, 7], [4, 4, 9], [8, 1, 7], [9, 1, 4], [10, 2, 2], [12, 4, 4]),
      notes([0, 1, 0], [1, 1, 2], [2, 1, 4], [3, 1, 7], [4, 4, 9], [8, 1, 7], [9, 1, 4], [10, 2, 2], [12, 4, 4]),
      notes([0, 1, 0], [1, 1, 2], [2, 1, 4], [3, 1, 7], [4, 4, 8], [8, 8, 7]),
    ],
  },
  {
    id: "hook.sparkle.b", reel: "hook", family: "sparkle", name: "Funkelmelodie", sound: "bell",
    bars: [
      notes([0, 6, 4], [6, 2, 5], [8, 6, 7], [14, 2, 5]),
      notes([0, 6, 4], [6, 2, 5], [8, 6, 7], [14, 2, 5]),
      notes([0, 6, 4], [6, 2, 5], [8, 6, 7], [14, 2, 5]),
      notes([0, 6, 4], [6, 2, 2], [8, 8, 0]),
    ],
  },
  {
    id: "hook.wild.a", reel: "hook", family: "wild", name: "Glitch-Hook", sound: "saw",
    bars: [notes([0, 1, 7], [1, 1, 7], [2, 1, 7], [3, 1, 4], [4, 2, 2], [6, 1, 7], [7, 1, 4], [8, 1, 9], [9, 1, 7], [10, 2, 4], [12, 1, 0], [13, 1, 2], [14, 2, 4])],
  },
  {
    id: "hook.wild.b", reel: "hook", family: "wild", name: "Oktav-Springer", sound: "saw",
    bars: [notes([0, 1, 0], [1, 1, 7], [3, 1, 0], [4, 1, 7], [6, 2, 4], [8, 1, 0], [9, 1, 7], [11, 1, 4], [12, 2, 2], [14, 2, 4])],
  },
  {
    id: "hook.dreamy.a", reel: "hook", family: "dreamy", name: "Mondlicht", sound: "flute",
    bars: [notes([0, 8, 2], [8, 4, 4], [12, 4, 1]), notes([0, 12, 0], [12, 4, -1])],
  },
  {
    id: "hook.dreamy.b", reel: "hook", family: "dreamy", name: "Schlafmütze", sound: "flute",
    bars: [
      notes([2, 6, 4], [8, 2, 2], [10, 6, 0]),
      notes([2, 6, 4], [8, 2, 2], [10, 6, 0]),
      notes([2, 6, 4], [8, 2, 2], [10, 6, 0]),
      notes([2, 4, 4], [6, 2, 5], [8, 8, 4]),
    ],
  },
  {
    id: "hook.club.a", reel: "hook", family: "club", name: "Tanzflächen-Riff", sound: "pluck",
    bars: [notes([0, 2, 4], [3, 2, 4], [6, 2, 2], [10, 2, 4], [12, 2, 5], [14, 2, 4])],
  },
  {
    id: "hook.club.b", reel: "hook", family: "club", name: "Kopfnicker", sound: "chip",
    bars: [
      notes([0, 1, 0], [3, 1, 0], [6, 1, 2], [8, 1, 4], [11, 1, 4], [14, 2, 2]),
      notes([0, 1, 0], [3, 1, 0], [6, 1, 2], [8, 1, 4], [11, 1, 4], [14, 2, 2]),
      notes([0, 1, 0], [3, 1, 0], [6, 1, 2], [8, 1, 4], [11, 1, 4], [14, 2, 2]),
      notes([0, 1, 7], [3, 1, 7], [6, 1, 5], [8, 1, 4], [11, 1, 2], [14, 2, 0]),
    ],
  },
  {
    id: "hook.anthem.a", reel: "hook", family: "anthem", name: "Oh-oh-oh", sound: "saw",
    bars: [
      notes([0, 4, 4], [4, 4, 4], [8, 6, 5], [14, 2, 4]),
      notes([0, 4, 4], [4, 4, 4], [8, 6, 5], [14, 2, 4]),
      notes([0, 4, 4], [4, 4, 4], [8, 6, 5], [14, 2, 4]),
      notes([0, 4, 2], [4, 4, 1], [8, 8, 0]),
    ],
  },
  {
    id: "hook.anthem.b", reel: "hook", family: "anthem", name: "Hände hoch", sound: "saw",
    bars: [notes([0, 3, 0], [3, 3, 2], [6, 2, 4], [8, 8, 7]), notes([0, 3, 7], [3, 3, 5], [6, 2, 4], [8, 8, 2])],
  },
];

const BASSES: MelodyVariant[] = [
  { id: "bass.sweet.a", reel: "bass", family: "sweet", name: "Hüpfbass", sound: "square", bars: [notes([0, 2, 0], [2, 2, 7], [4, 2, 0], [6, 2, 7], [8, 2, 0], [10, 2, 7], [12, 2, 0], [14, 2, 7])] },
  { id: "bass.sweet.b", reel: "bass", family: "sweet", name: "Gummiband", sound: "square", bars: [notes([0, 3, 0], [3, 3, 0], [6, 2, 4], [8, 3, 0], [11, 3, 0], [14, 2, 4])] },
  { id: "bass.sparkle.a", reel: "bass", family: "sparkle", name: "Samtboden", sound: "sub", bars: [notes([0, 14, 0], [14, 2, 4])] },
  { id: "bass.sparkle.b", reel: "bass", family: "sparkle", name: "Perlenkette", sound: "sub", bars: [notes([0, 6, 0], [6, 2, 0], [8, 8, -3])] },
  { id: "bass.wild.a", reel: "bass", family: "wild", name: "808-Rutsche", sound: "808", bars: [notes([0, 6, 0], [6, 4, 0], [10, 2, 7, "glide"], [12, 4, 0, "glide"])] },
  { id: "bass.wild.b", reel: "bass", family: "wild", name: "Wummer", sound: "808", bars: [notes([0, 3, 0], [3, 3, 0], [7, 1, 7], [8, 4, 0], [12, 2, 2], [14, 2, 4])] },
  { id: "bass.dreamy.a", reel: "bass", family: "dreamy", name: "Watte", sound: "sub", bars: [notes([0, 16, 0])] },
  { id: "bass.dreamy.b", reel: "bass", family: "dreamy", name: "Schaukel", sound: "sub", bars: [notes([0, 8, 0], [8, 6, 4], [14, 2, 5])] },
  { id: "bass.club.a", reel: "bass", family: "club", name: "Offbeat", sound: "saw", bars: [notes([2, 2, 0], [6, 2, 0], [10, 2, 0], [14, 2, 0])] },
  { id: "bass.club.b", reel: "bass", family: "club", name: "Rollbass", sound: "saw", bars: [notes([1, 1, 0], [2, 1, 0], [3, 1, 0], [5, 1, 0], [6, 1, 0], [7, 1, 0], [9, 1, 0], [10, 1, 0], [11, 1, 0], [13, 1, 0], [14, 1, 0], [15, 1, 0])] },
  { id: "bass.anthem.a", reel: "bass", family: "anthem", name: "Viertel", sound: "808", bars: [notes([0, 4, 0], [4, 4, 0], [8, 4, 0], [12, 4, 4])] },
  { id: "bass.anthem.b", reel: "bass", family: "anthem", name: "Marsch", sound: "808", bars: [notes([0, 6, 0], [6, 2, 0], [8, 6, 4], [14, 2, 0])] },
];

/** The diamonds: one per reel, unlocked by jackpots; each counts as a joker on the line. */
const DIAMONDS: Variant[] = [
  {
    id: "beat.rare", reel: "beat", family: "rare", name: "Diamant-Beat", kit: "hyper",
    bar: { kick: "X...X...X...X...", clap: "....X.......X...", hat: "xxx3xxx3xxx3xxx3", openhat: "..o...o...o...o.", shaker: "oxoxoxoxoxoxoxox" },
    fill: { kick: "X...X...X.X.X.X.", clap: "....X.......XXXX", hat: "xxx3xxx3xxx3....", openhat: "..............X." },
  },
  { id: "chords.rare", reel: "chords", family: "rare", name: "Diamant-Akkorde", progression: four(nines(0, 4, 5, 3)), rhythm: "sync", sound: "supersaw" },
  {
    id: "hook.rare", reel: "hook", family: "rare", name: "Diamant-Hook", sound: "bell",
    bars: [
      notes([0, 1, 0], [1, 1, 2], [2, 1, 4], [3, 1, 7], [4, 2, 9], [6, 2, 7], [8, 1, 4], [9, 1, 7], [10, 2, 9], [12, 2, 7], [14, 2, 4]),
      notes([0, 2, 7], [2, 2, 9], [4, 4, 7], [8, 8, 4]),
    ],
  },
  { id: "bass.rare", reel: "bass", family: "rare", name: "Diamant-Bass", sound: "808", bars: [notes([0, 3, 0], [3, 1, 7, "glide"], [4, 2, 0, "glide"], [6, 2, 0], [8, 3, 4], [11, 1, 7, "glide"], [12, 2, 0, "glide"], [14, 2, 2])] },
];

const VARIANTS: Record<string, Variant> = Object.fromEntries([...BEATS, ...CHORD_VARIANTS, ...HOOKS, ...BASSES, ...DIAMONDS].map((variant) => [variant.id, variant]));

/**
 * The reel strips, in the order the symbols pass the window. Each family
 * appears twice per reel; the diamond waits at the end of every strip and is
 * only reached once a jackpot unlocked it for that reel.
 */
export const STRIPS: Record<ReelId, readonly string[]> = {
  beat: ["sweet.a", "wild.a", "dreamy.a", "club.a", "sparkle.a", "anthem.a", "sweet.b", "club.b", "wild.b", "sparkle.b", "dreamy.b", "anthem.b", "rare"].map((id) => `beat.${id}`),
  chords: ["sweet.a", "club.a", "sparkle.a", "wild.a", "anthem.a", "dreamy.a", "club.b", "sweet.b", "dreamy.b", "anthem.b", "wild.b", "sparkle.b", "rare"].map((id) => `chords.${id}`),
  hook: ["sweet.a", "sparkle.a", "dreamy.a", "wild.a", "club.a", "anthem.a", "sparkle.b", "sweet.b", "wild.b", "anthem.b", "dreamy.b", "club.b", "rare"].map((id) => `hook.${id}`),
  bass: ["sweet.a", "anthem.a", "wild.a", "sparkle.a", "club.a", "dreamy.a", "wild.b", "sweet.b", "club.b", "sparkle.b", "anthem.b", "dreamy.b", "rare"].map((id) => `bass.${id}`),
};

/** Symbols on a strip before its diamond is unlocked. */
export const STRIP_LENGTH = 12;
/** Symbols on a strip with its diamond. */
export const FULL_STRIP_LENGTH = 13;
/** The order in which jackpots unlock the diamonds. */
export const UNLOCK_ORDER: readonly ReelId[] = ["beat", "bass", "chords", "hook"];

export function stripLength(reel: ReelId, unlocked: readonly ReelId[]): number {
  return unlocked.includes(reel) ? FULL_STRIP_LENGTH : STRIP_LENGTH;
}

export function variantAt(reel: ReelId, position: number): Variant {
  const strip = STRIPS[reel];
  const id = strip[((Math.round(position) % strip.length) + strip.length) % strip.length]!;
  return VARIANTS[id]!;
}

export function allVariants(): Variant[] {
  return Object.values(VARIANTS);
}

/** The sounds the "Klang" button cycles through for a reel. */
export function soundsFor(reel: ReelId): readonly string[] {
  switch (reel) {
    case "beat": return KITS;
    case "chords": return CHORD_SOUNDS;
    case "hook": return HOOK_SOUNDS;
    case "bass": return BASS_SOUNDS;
  }
}

export function defaultSound(variant: Variant): string {
  return variant.reel === "beat" ? variant.kit : variant.sound;
}
