import { shallowRef, type ShallowRef } from "vue";
import type { Knobs } from "./audio/synth";
import type { Jackpot } from "./machine/machine";
import { wrap } from "./machine/machine";
import type { ReelSetting } from "./music/loop";
import type { Family, ReelId } from "./music/reels";
import { FAMILIES, FULL_STRIP_LENGTH, REELS, soundsFor, stripLength, STRIPS, UNLOCK_ORDER } from "./music/reels";
import type { KeyName } from "./music/theory";
import { KEY_NAMES } from "./music/theory";

const PROJECT_KEY = "jackpop.project.v1";
const BACKUP_KEY = "jackpop.project.v1.backup";
const STATS_KEY = "jackpop.stats.v1";
const HISTORY_LIMIT = 100;
const MERGE_WINDOW_MS = 1_200;

export const MIN_TEMPO = 90;
export const MAX_TEMPO = 180;
export const KNOB_NAMES = ["sugar", "glitter", "chaos"] as const;
export type KnobName = (typeof KNOB_NAMES)[number];

/** The voice from the coin slot: the take itself lives in IndexedDB under `id`. */
export interface VoiceRef {
  id: string;
  /** Loop position (sixteenths) where the take starts. */
  startStep: number;
  /** Tempo it was sung at. */
  tempo: number;
  muted: boolean;
}

export type PlayMode = "loop" | "song";

export interface Project {
  schemaVersion: 1;
  /** Loop repeats the four bars; Song builds intro, verse, chorus, drop, lifted chorus and outro from them. */
  mode: PlayMode;
  key: KeyName;
  tempo: number;
  volume: number;
  knobs: Knobs;
  reels: Record<ReelId, ReelSetting>;
  voice: VoiceRef | null;
}

/** Counters and rewards that survive undo: pulls are pulls. */
export interface Stats {
  pulls: number;
  jackpots: number;
  best: { family: Family; count: number } | null;
  /** Reels whose diamond a jackpot has unlocked, in unlock order. */
  unlocked: ReelId[];
}

export interface Storage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const reel = (id: string, strip: readonly string[]): ReelSetting => ({ position: Math.max(0, strip.indexOf(id)), held: false, sound: null, shift: 0 });

/** Three hearts and a flame: the machine greets you one symbol short of a jackpot. */
export function createProject(): Project {
  return {
    schemaVersion: 1,
    mode: "loop",
    key: "C",
    tempo: 150,
    volume: 0.85,
    knobs: { sugar: 0.5, glitter: 0.35, chaos: 0.2 },
    reels: {
      beat: reel("beat.club.a", STRIPS.beat),
      chords: reel("chords.sweet.a", STRIPS.chords),
      hook: reel("hook.sweet.a", STRIPS.hook),
      bass: reel("bass.sweet.a", STRIPS.bass),
    },
    voice: null,
  };
}

function sanitizeVoice(value: unknown): VoiceRef | null {
  const source = record(value);
  if (typeof source.id !== "string" || !/^[a-z0-9-]{4,64}$/.test(source.id)) return null;
  const startStep = typeof source.startStep === "number" && Number.isFinite(source.startStep) ? ((source.startStep % 64) + 64) % 64 : 0;
  const tempo = typeof source.tempo === "number" && Number.isFinite(source.tempo) ? Math.max(MIN_TEMPO, Math.min(MAX_TEMPO, source.tempo)) : 150;
  return { id: source.id, startStep, tempo, muted: source.muted === true };
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function unit(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;
}

/** Any stored value becomes a complete, valid project. */
export function sanitizeProject(value: unknown): Project {
  const source = record(value);
  const fallback = createProject();
  const knobs = record(source.knobs);
  const reels = record(source.reels);
  return {
    schemaVersion: 1,
    mode: source.mode === "song" ? "song" : "loop",
    key: KEY_NAMES.includes(source.key as KeyName) ? (source.key as KeyName) : fallback.key,
    tempo: typeof source.tempo === "number" && Number.isFinite(source.tempo) ? Math.round(Math.max(MIN_TEMPO, Math.min(MAX_TEMPO, source.tempo))) : fallback.tempo,
    volume: unit(source.volume, fallback.volume),
    knobs: Object.fromEntries(KNOB_NAMES.map((name) => [name, unit(knobs[name], fallback.knobs[name])])) as unknown as Knobs,
    reels: Object.fromEntries(REELS.map((id) => {
      const stored = record(reels[id]);
      const sound = typeof stored.sound === "string" && soundsFor(id).includes(stored.sound) ? stored.sound : null;
      const shift = typeof stored.shift === "number" && Number.isFinite(stored.shift) ? Math.max(-1, Math.min(1, Math.round(stored.shift))) : 0;
      return [id, {
        position: typeof stored.position === "number" && Number.isFinite(stored.position) ? wrap(stored.position, FULL_STRIP_LENGTH) : fallback.reels[id].position,
        held: stored.held === true,
        sound,
        shift,
      }];
    })) as Record<ReelId, ReelSetting>,
    voice: sanitizeVoice(source.voice),
  };
}

function sanitizeStats(value: unknown): Stats {
  const source = record(value);
  const count = (key: string) => (typeof source[key] === "number" && Number.isFinite(source[key]) ? Math.max(0, Math.floor(source[key] as number)) : 0);
  const best = record(source.best);
  const unlocked = Array.isArray(source.unlocked) ? source.unlocked : [];
  return {
    pulls: count("pulls"),
    jackpots: count("jackpots"),
    best: ([...FAMILIES, "rare"] as string[]).includes(best.family as string) && typeof best.count === "number" ? { family: best.family as Family, count: best.count } : null,
    unlocked: UNLOCK_ORDER.filter((reel) => unlocked.includes(reel)),
  };
}

function safeLocalStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * The machine's state. Every change is an undo step (a knob turn is one,
 * however far it goes) and is saved right away with the previous save kept
 * as backup. A pull can be undone too: the loop you had is never lost.
 */
export class JackpopStore {
  readonly project: ShallowRef<Project>;
  readonly stats: ShallowRef<Stats>;
  readonly canUndo = shallowRef(false);
  readonly canRedo = shallowRef(false);
  readonly restoredFromBackup: boolean;
  private undoStack: Project[] = [];
  private redoStack: Project[] = [];
  private lastMerge: { key: string; at: number } | null = null;

  constructor(private readonly storage: Storage | null = safeLocalStorage()) {
    const loaded = this.load();
    this.project = shallowRef(loaded.project);
    this.restoredFromBackup = loaded.fromBackup;
    this.stats = shallowRef(this.loadStats());
  }

  edit(change: (project: Project) => void, mergeKey?: string): boolean {
    const before = this.project.value;
    const next = structuredClone(before);
    change(next);
    const clean = sanitizeProject(next);
    if (JSON.stringify(clean) === JSON.stringify(before)) return false;
    const now = Date.now();
    const merged = mergeKey !== undefined && this.lastMerge?.key === mergeKey && now - this.lastMerge.at < MERGE_WINDOW_MS;
    this.lastMerge = mergeKey === undefined ? null : { key: mergeKey, at: now };
    if (!merged) {
      this.undoStack.push(before);
      if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    }
    this.redoStack = [];
    this.commit(clean);
    return true;
  }

  toggleHold(id: ReelId): void {
    this.edit((project) => { project.reels[id].held = !project.reels[id].held; });
  }

  /** How many symbols a reel's strip has right now (twelve, thirteen with its diamond). */
  length(id: ReelId): number {
    return stripLength(id, this.stats.value.unlocked);
  }

  /** A new symbol brings its own sound and register; the reel's tweaks start over. */
  private land(project: Project, id: ReelId, position: number): void {
    const setting = project.reels[id];
    const landed = wrap(position, this.length(id));
    if (landed === setting.position) return;
    setting.position = landed;
    setting.sound = null;
    setting.shift = 0;
  }

  nudge(id: ReelId, delta: number): void {
    this.edit((project) => this.land(project, id, project.reels[id].position + delta));
  }

  applySpin(positions: Partial<Record<ReelId, number>>): void {
    this.edit((project) => {
      for (const [id, position] of Object.entries(positions) as [ReelId, number][]) this.land(project, id, position);
    });
  }

  setSound(id: ReelId, sound: string | null): void {
    this.edit((project) => { project.reels[id].sound = sound; });
  }

  setShift(id: ReelId, shift: number): void {
    this.edit((project) => { project.reels[id].shift = shift; });
  }

  setKnob(name: KnobName, value: number): void {
    this.edit((project) => { project.knobs[name] = value; }, `knob:${name}`);
  }

  setMode(mode: PlayMode): void {
    this.edit((project) => { project.mode = mode; });
  }

  /** Unlocks the next reel's diamond; returns that reel, or `null` when all are unlocked. */
  unlockNext(): ReelId | null {
    const stats = this.stats.value;
    const next = UNLOCK_ORDER.find((reel) => !stats.unlocked.includes(reel)) ?? null;
    if (!next) return null;
    this.stats.value = { ...stats, unlocked: [...stats.unlocked, next] };
    this.write(STATS_KEY, JSON.stringify(this.stats.value));
    return next;
  }

  /** Diamonds that arrived with a friend's recipe; returns the ones that are new here. */
  grantDiamonds(reels: readonly ReelId[]): ReelId[] {
    const stats = this.stats.value;
    const fresh = reels.filter((reel) => !stats.unlocked.includes(reel));
    if (fresh.length === 0) return [];
    this.stats.value = { ...stats, unlocked: UNLOCK_ORDER.filter((reel) => stats.unlocked.includes(reel) || fresh.includes(reel)) };
    this.write(STATS_KEY, JSON.stringify(this.stats.value));
    return fresh;
  }

  setTempo(tempo: number): void {
    this.edit((project) => { project.tempo = tempo; }, "tempo");
  }

  /** A new take replaces the old one; undo brings the old one back. */
  setVoice(voice: VoiceRef | null): void {
    this.edit((project) => { project.voice = voice; });
  }

  toggleVoiceMute(): void {
    this.edit((project) => { if (project.voice) project.voice.muted = !project.voice.muted; });
  }

  recordPull(jackpot: Jackpot | null): void {
    const stats = this.stats.value;
    const best = jackpot && (!stats.best || jackpot.count > stats.best.count) ? { family: jackpot.family, count: jackpot.count } : stats.best;
    this.stats.value = { ...stats, pulls: stats.pulls + 1, jackpots: stats.jackpots + (jackpot ? 1 : 0), best };
    this.write(STATS_KEY, JSON.stringify(this.stats.value));
  }

  undo(): void {
    const previous = this.undoStack.pop();
    if (!previous) return;
    this.redoStack.push(this.project.value);
    this.lastMerge = null;
    this.commit(previous);
  }

  redo(): void {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(this.project.value);
    this.lastMerge = null;
    this.commit(next);
  }

  private commit(project: Project): void {
    this.project.value = project;
    this.canUndo.value = this.undoStack.length > 0;
    this.canRedo.value = this.redoStack.length > 0;
    const current = this.read(PROJECT_KEY);
    if (current) this.write(BACKUP_KEY, current);
    this.write(PROJECT_KEY, JSON.stringify(project));
  }

  private read(key: string): string | null {
    try {
      return this.storage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  }

  private write(key: string, value: string): void {
    try {
      this.storage?.setItem(key, value);
    } catch {
      // Storage full or blocked: the session keeps working, it just is not saved.
    }
  }

  private load(): { project: Project; fromBackup: boolean } {
    for (const [key, fromBackup] of [[PROJECT_KEY, false], [BACKUP_KEY, true]] as const) {
      try {
        const raw = this.read(key);
        if (!raw) continue;
        const value = JSON.parse(raw) as unknown;
        if (record(value).schemaVersion === 1) return { project: sanitizeProject(value), fromBackup };
      } catch {
        // Damaged JSON: try the backup, then start fresh.
      }
    }
    return { project: createProject(), fromBackup: false };
  }

  private loadStats(): Stats {
    try {
      return sanitizeStats(JSON.parse(this.read(STATS_KEY) ?? "{}"));
    } catch {
      return sanitizeStats({});
    }
  }
}
