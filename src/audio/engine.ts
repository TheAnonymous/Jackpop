import type { Jackpot } from "../machine/machine";
import { planPull, planSingle } from "../machine/machine";
import type { LoopData } from "../music/loop";
import { firstNote, LOOP_STEPS } from "../music/loop";
import type { ReelId } from "../music/reels";
import { REELS } from "../music/reels";
import type { Section, SectionName } from "../music/song";
import { BONUS, LOOP_SECTION, SONG, SONG_DROP } from "../music/song";
import { Clock } from "./clock";
import { playThroughSilentSwitch } from "./ios-audio";
import type { Knobs } from "./synth";
import { PopSynth } from "./synth";

/*
 * Plays the loop and runs the machine's moments in time: sixteenths are
 * scheduled a little ahead on the audio clock, a pull silences the spinning
 * reels, lets each one slam in on its beat and drops the loop back in.
 * The screen follows through timed events, so reels stop on the beat you hear.
 */

export type VisualEvent =
  | { type: "step"; time: number; loopStep: number; spinning: boolean; section: SectionName; label: string; sectionBar: number; choir: boolean }
  | { type: "stop"; time: number; reel: ReelId }
  | { type: "restart"; time: number; jackpot: Jackpot | null }
  /** The song has played its outro. */
  | { type: "end"; time: number };

export type PlayMode = "loop" | "song";

export interface SpinPlan {
  start: number;
  stops: Partial<Record<ReelId, number>>;
  restart: number | null;
}

export interface EngineSettings {
  knobs: Knobs;
  tempo: number;
  volume: number;
}

interface Spin {
  reels: ReelId[];
  stops: Partial<Record<ReelId, number>>;
  lastStop: number;
  restart: number | null;
  target: LoopData;
  jackpot: Jackpot | null;
}

const LOOKAHEAD_SECONDS = 0.12;
/** What the verse's lighter beat keeps. */
const LIGHT_BEAT = new Set(["kick", "hat", "openhat"]);
const START_DELAY_SECONDS = 0.06;

/** A repeatable random number per step, so chaos glitches are the same in every render of a pass. */
function chance(step: number, salt: number): number {
  let value = Math.imul(step + 1, 2_654_435_761) ^ Math.imul(salt + 7, 1_597_334_677);
  value = Math.imul(value ^ (value >>> 15), 2_246_822_507);
  value = Math.imul(value ^ (value >>> 13), 3_266_489_909);
  return ((value ^ (value >>> 16)) >>> 0) / 4_294_967_296;
}

/** Who plays alone while "Solo hören" is held. */
export type SoloPart = ReelId | "voice";

/** One choir voice: the take tuned to a harmony line, plain and lifted, and where it stands. */
export interface ChoirVoice {
  base: AudioBuffer;
  lifted: AudioBuffer | null;
  pan: number;
  level: number;
  delay: number;
}

export class PopEngine {
  private context: BaseAudioContext | null = null;
  private synth: PopSynth | null = null;
  private clock: Clock | null = null;
  private loop: LoopData;
  private settings: EngineSettings;
  private running = false;
  private absStep = 0;
  private loopStep = 0;
  private nextTime = 0;
  private spin: Spin | null = null;
  private solo: SoloPart | null = null;
  private events: VisualEvent[] = [];
  private voiceBuffer: AudioBuffer | null = null;
  /** The voice tuned a whole tone up, for the lifted chorus. */
  private liftedVoice: AudioBuffer | null = null;
  private voiceSource: AudioBufferSourceNode | null = null;
  private choir: ChoirVoice[] = [];
  /** The choir voices playing, each with its delay: it also stops that much later. */
  private choirSources: { source: AudioBufferSourceNode; delay: number }[] = [];
  private mode: PlayMode = "loop";
  private pendingMode: PlayMode | null = null;
  /** The sections still to play; the first is playing. */
  private queue: Section[] = [LOOP_SECTION];
  private sectionBar = -1;
  private finished = false;
  private recording = false;
  /** When the loop last started from its first step, for placing a recording in it. */
  private loopStarts: number[] = [];
  private createdListeners: (() => void)[] = [];

  constructor(loop: LoopData, settings: EngineSettings, private readonly options: { context?: BaseAudioContext; latencyHint?: AudioContextLatencyCategory } = {}) {
    this.loop = loop;
    this.settings = { ...settings, knobs: { ...settings.knobs } };
  }

  get playing(): boolean {
    return this.running;
  }

  get spinning(): boolean {
    return this.spin !== null;
  }

  /** The live audio context, once the first tap created it (the microphone joins it). */
  get audioContext(): AudioContext | null {
    return this.context instanceof AudioContext ? this.context : null;
  }

  get ready(): boolean {
    return this.context !== null && (this.context instanceof OfflineAudioContext || this.context.state === "running");
  }

  /** Called once the audio context exists (things that need it, like the tuned voice, can be built then). */
  onceCreated(listener: () => void): void {
    if (this.context) listener();
    else this.createdListeners.push(listener);
  }

  /** Creates the audio context on the first tap (browsers only allow sound after one) and wakes it up. */
  async unlock(): Promise<boolean> {
    // Inside the tap that starts the sound; only the live context plays through a speaker.
    if (!this.options.context) playThroughSilentSwitch();
    if (!this.context) {
      this.context = this.options.context ?? new AudioContext({ latencyHint: this.options.latencyHint ?? "balanced" });
      this.synth = new PopSynth(this.context);
      this.applySettings();
      for (const listener of this.createdListeners.splice(0)) listener();
    }
    if (this.context instanceof AudioContext && this.context.state !== "running") {
      await this.context.resume().catch(() => undefined);
    }
    return this.ready;
  }

  /** Where the listener is: the audio clock minus what is still on its way to the speaker. */
  visualTime(): number {
    const context = this.context;
    if (!context) return 0;
    const latency = context instanceof AudioContext ? (context.outputLatency || context.baseLatency || 0) : 0;
    return context.currentTime - latency;
  }

  async start(): Promise<boolean> {
    if (!(await this.unlock())) return false;
    if (!this.running) {
      this.begin();
      this.scheduleAhead();
    }
    return true;
  }

  stop(): void {
    const context = this.context;
    this.running = false;
    this.spin = null;
    this.clock?.stop();
    this.events = [];
    this.loopStarts = [];
    if (context && this.synth) {
      this.synth.close(context.currentTime);
      this.stopVoice(context.currentTime + 0.05);
    }
  }

  setLoop(loop: LoopData): void {
    if (this.spin) this.spin.target = loop;
    else {
      this.loop = loop;
      this.synth?.setSounds(loop.kit, loop.bassSound);
    }
  }

  setSettings(settings: EngineSettings): void {
    this.settings = { ...settings, knobs: { ...settings.knobs } };
    this.applySettings();
  }

  /** Loop or song; a change while playing takes effect when the loop next starts from the top. */
  setMode(mode: PlayMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    if (this.running) this.pendingMode = mode;
  }

  /** The section playing now. */
  get section(): Section {
    return this.queue[0] ?? LOOP_SECTION;
  }

  setSolo(part: SoloPart | null): void {
    this.solo = part;
    const context = this.context;
    if (!context || !this.running) return;
    // The voice is one long sample: bring it in or out right away.
    if (part !== null && part !== "voice") this.stopVoice(this.nextTime);
    else if (!this.voiceSource) this.startVoiceNow();
  }

  /**
   * The tuned voice, one loop long (and a whole tone up for lifted sections);
   * it joins at the current loop position. A new voice drops the old choir.
   */
  setVoice(buffer: AudioBuffer | null, lifted: AudioBuffer | null = null): void {
    this.voiceBuffer = buffer;
    this.liftedVoice = lifted;
    this.choir = [];
    this.restartVoice();
  }

  /** The choir for the current voice; it sings with it where a section has a choir. */
  setChoir(voices: ChoirVoice[]): void {
    this.choir = voices;
    if (this.choirAllowed()) this.restartVoice();
  }

  private restartVoice(): void {
    if (!this.context) return;
    this.stopVoice(this.running ? this.nextTime : this.context.currentTime);
    this.startVoiceNow();
  }

  /** While the coin slot records, the old voice keeps quiet. */
  setRecording(recording: boolean): void {
    this.recording = recording;
    if (!this.context) return;
    if (recording) this.stopVoice(this.context.currentTime);
    else this.startVoiceNow();
  }

  /** The loop position (in sixteenths) that was sounding at an audio-clock time. */
  loopPositionAt(time: number): number {
    const step = this.stepDuration;
    const start = [...this.loopStarts].reverse().find((candidate) => candidate <= time) ?? this.loopStarts[0];
    if (start === undefined) return 0;
    const position = (time - start) / step;
    return ((position % LOOP_STEPS) + LOOP_STEPS) % LOOP_STEPS;
  }

  get loopSeconds(): number {
    return LOOP_STEPS * this.stepDuration;
  }

  /**
   * The lever: every reel that is not held spins, stops on its beat of the
   * coming bar, and the loop drops back in from the top. Starts the music if
   * it was quiet.
   */
  async pull(strength: number, held: ReadonlySet<ReelId>, target: LoopData, jackpot: Jackpot | null): Promise<SpinPlan | null> {
    if (!(await this.unlock()) || this.spin) return null;
    const spinning = REELS.filter((reel) => !held.has(reel));
    if (spinning.length === 0) return null;
    if (!this.running) this.begin();
    const plan = planPull(this.absStep, this.loopStep, strength, spinning);
    this.startSpin(spinning, plan.stops, plan.restart, target, jackpot);
    this.stopVoice(this.nextTime);
    const restart = this.timeOf(plan.restart!);
    this.synth!.riser(this.nextTime, restart);
    this.scheduleAhead();
    return this.planTimes(plan.stops, plan.restart);
  }

  /** One reel spins on its own and carries on with its new part as soon as it stops. */
  async spinReel(reel: ReelId, target: LoopData): Promise<SpinPlan | null> {
    if (!(await this.unlock()) || this.spin) return null;
    if (!this.running) this.begin();
    const plan = planSingle(this.absStep, this.loopStep, reel);
    this.startSpin([reel], plan.stops, null, target, null);
    this.scheduleAhead();
    return this.planTimes(plan.stops, null);
  }

  /** The events whose moment has come, oldest first. */
  drainEvents(upTo: number): VisualEvent[] {
    let count = 0;
    while (count < this.events.length && this.events[count]!.time <= upTo) count += 1;
    return this.events.splice(0, count);
  }

  // ---- sounds of the machine, played right away ------------------------

  grumble(): void {
    if (this.ready) this.synth!.grumble(this.context!.currentTime + 0.01);
  }

  coin(): void {
    if (this.ready) this.synth!.coin(this.context!.currentTime + 0.01);
  }

  ratchet(depth: number): void {
    if (this.ready) this.synth!.ratchet(this.context!.currentTime + 0.005, depth);
  }

  clunk(): void {
    if (this.ready) this.synth!.clunk(this.context!.currentTime + 0.005);
  }

  tick(): void {
    if (this.ready) this.synth!.tick(this.context!.currentTime + 0.005, 0.25);
  }

  /** Lets a reel's part sound once, for feedback while the music is stopped. */
  preview(reel: ReelId, loop: LoopData): void {
    if (!this.ready || this.running) return;
    this.synth!.open(this.context!.currentTime);
    this.synth!.setSounds(loop.kit, loop.bassSound);
    this.stopHit(reel, loop, this.context!.currentTime + 0.02, 15 / this.settings.tempo);
  }

  dispose(): void {
    this.stop();
    this.clock?.dispose();
    if (this.context instanceof AudioContext && !this.options.context) void this.context.close().catch(() => undefined);
    this.context = null;
    this.synth = null;
  }

  // ---- offline rendering (tests, later the ticket) ----------------------

  /** Schedules everything up to `seconds` at once; for an OfflineAudioContext before it renders. */
  renderUntil(seconds: number): void {
    if (!this.synth) throw new Error("unlock() first");
    if (!this.running) this.begin(0.02);
    while (this.nextTime < seconds) this.scheduleStep();
  }

  // ---- scheduling -------------------------------------------------------

  private applySettings(): void {
    const synth = this.synth;
    if (!synth || !this.context) return;
    const time = this.context.currentTime;
    synth.setKnobs(this.settings.knobs, time);
    synth.setTempo(this.settings.tempo, time);
    synth.setVolume(this.settings.volume, time);
    synth.setSounds(this.loop.kit, this.loop.bassSound);
  }

  private begin(at = this.context!.currentTime + START_DELAY_SECONDS): void {
    this.running = true;
    this.absStep = 0;
    this.loopStep = 0;
    this.nextTime = at;
    this.events = [];
    this.queue = this.sectionsFor(false);
    this.sectionBar = -1;
    this.finished = false;
    this.pendingMode = null;
    this.synth!.open(at);
    if (this.context instanceof AudioContext) {
      this.clock ??= new Clock(() => this.scheduleAhead());
      this.clock.start();
    }
  }

  private get stepDuration(): number {
    return 15 / this.settings.tempo;
  }

  private timeOf(step: number): number {
    return this.nextTime + (step - this.absStep) * this.stepDuration;
  }

  private planTimes(stops: Partial<Record<ReelId, number>>, restart: number | null): SpinPlan {
    const times: Partial<Record<ReelId, number>> = {};
    for (const [reel, step] of Object.entries(stops) as [ReelId, number][]) times[reel] = this.timeOf(step);
    return { start: this.nextTime, stops: times, restart: restart === null ? null : this.timeOf(restart) };
  }

  private startSpin(reels: ReelId[], stops: Partial<Record<ReelId, number>>, restart: number | null, target: LoopData, jackpot: Jackpot | null): void {
    this.spin = { reels, stops, lastStop: Math.max(...Object.values(stops)), restart, target, jackpot };
  }

  private scheduleAhead(): void {
    const context = this.context;
    if (!this.running || !context) return;
    const until = context.currentTime + LOOKAHEAD_SECONDS;
    // After a stall (a hidden tab, a busy phone) skip ahead instead of rushing through missed steps.
    if (this.nextTime < context.currentTime - 0.2) {
      const behind = Math.ceil((context.currentTime - this.nextTime) / this.stepDuration);
      this.absStep += behind;
      this.loopStep = (this.loopStep + behind) % LOOP_STEPS;
      this.nextTime += behind * this.stepDuration;
    }
    while (this.nextTime < until) this.scheduleStep();
  }

  /** What plays after a start or a pull: the song from the top (or its drop after a jackpot), or the loop (a bonus first after a jackpot). */
  private sectionsFor(jackpot: boolean): Section[] {
    if (this.mode === "song") return jackpot ? SONG.slice(SONG_DROP) : [...SONG];
    return jackpot ? [...BONUS, LOOP_SECTION] : [LOOP_SECTION];
  }

  /** A new bar: move through the sections, with their crash, build and ending. */
  private advanceBar(time: number, stepDuration: number): void {
    const synth = this.synth!;
    if (this.finished) return;
    this.sectionBar += 1;
    let last = this.section;
    while (this.queue.length > 0 && this.sectionBar >= this.queue[0]!.bars) {
      last = this.queue.shift()!;
      this.sectionBar = 0;
    }
    if (this.queue.length === 0) {
      if (this.mode === "song") {
        // The song is over: it stays on its last section, silent, until playback stops.
        this.queue = [last];
        this.finished = true;
        synth.crash(time, 0.35);
        this.events.push({ type: "end", time });
        return;
      }
      this.queue = [LOOP_SECTION];
    }
    const section = this.section;
    if (this.sectionBar === 0 && section.crash) synth.crash(time, 0.45);
    if (section.build && this.sectionBar === section.bars - 1) synth.riser(time, time + 16 * stepDuration);
  }

  private scheduleStep(): void {
    const synth = this.synth!;
    const time = this.nextTime;
    const stepDuration = this.stepDuration;
    const step = this.absStep;
    let spin = this.spin;

    if (spin && spin.restart === step) {
      this.loop = spin.target;
      this.loopStep = 0;
      this.stopVoice(time);
      synth.setSounds(this.loop.kit, this.loop.bassSound);
      synth.crash(time, 0.5);
      if (spin.jackpot) synth.jingle(time, this.loop.harmony[0]!.voicing, stepDuration);
      this.events.push({ type: "restart", time, jackpot: spin.jackpot });
      this.queue = this.sectionsFor(spin.jackpot !== null);
      this.sectionBar = -1;
      this.finished = false;
      this.pendingMode = null;
      this.spin = spin = null;
    }

    const loopStep = this.loopStep;
    if (loopStep === 0 && this.pendingMode) {
      this.queue = this.sectionsFor(false);
      this.sectionBar = -1;
      this.finished = false;
      this.pendingMode = null;
    }
    if (loopStep % 16 === 0) this.advanceBar(time, stepDuration);
    const section = this.section;
    if (loopStep === 0) {
      this.loopStarts = [...this.loopStarts.slice(-3), time];
      if (!spin) this.startVoice(time, 0);
    }
    if (this.finished) {
      this.events.push({ type: "step", time, loopStep, spinning: false, section: section.name, label: section.label, sectionBar: this.sectionBar, choir: false });
      this.absStep += 1;
      this.loopStep = (loopStep + 1) % LOOP_STEPS;
      this.nextTime += stepDuration;
      return;
    }
    const inSection = this.sectionBar * 16 + (loopStep % 16);
    const level = section.fade ? 1 - 0.85 * (inSection / (section.bars * 16)) : 1;
    for (const reel of REELS) {
      if (spin?.reels.includes(reel)) {
        if (spin.stops[reel] === step) {
          if (step === Math.min(...Object.values(spin.stops))) synth.setSounds(spin.target.kit, spin.target.bassSound);
          this.stopHit(reel, spin.target, time, stepDuration);
          synth.clack(time);
          this.events.push({ type: "stop", time, reel });
        }
        continue;
      }
      if (this.solo && this.solo !== reel) continue;
      if (!section.parts.includes(reel)) continue;
      this.playReel(reel, loopStep, time, stepDuration, step, section, level);
    }

    if (spin) {
      if (step < spin.lastStop) synth.tick(time, 0.07);
      if (spin.restart === null && step >= spin.lastStop) {
        // A single reel has landed: its new part plays from the next step on.
        this.loop = spin.target;
        synth.setSounds(this.loop.kit, this.loop.bassSound);
        this.spin = null;
      }
    } else if (!this.solo && section.sparkle) {
      this.playSparkle(loopStep, time, section.transpose, level);
    }

    this.events.push({ type: "step", time, loopStep, spinning: spin !== null, section: section.name, label: section.label, sectionBar: this.sectionBar, choir: this.choirSources.length > 0 });
    this.absStep += 1;
    this.loopStep = (loopStep + 1) % LOOP_STEPS;
    this.nextTime += stepDuration;
  }

  private voiceAllowed(): boolean {
    const section = this.section;
    return this.voiceBuffer !== null && !this.recording && !this.finished && section.voice && (this.solo === null || this.solo === "voice");
  }

  /** Whether the choir sings now: in a section with a choir, from its choir bar on. */
  private choirAllowed(): boolean {
    const from = this.section.choir;
    return this.choir.length > 0 && from !== null && this.sectionBar >= from && this.voiceAllowed();
  }

  private startVoice(time: number, offset: number): void {
    if (!this.voiceAllowed() || !this.synth) return;
    this.stopVoice(time);
    const lifted = this.section.transpose !== 0;
    const buffer = lifted && this.liftedVoice ? this.liftedVoice : this.voiceBuffer!;
    this.voiceSource = this.synth.voice(buffer, time, offset);
    if (!this.choirAllowed()) return;
    for (const voice of this.choir) {
      const choirBuffer = lifted ? voice.lifted : voice.base;
      if (choirBuffer) this.choirSources.push({ source: this.synth.choir(choirBuffer, time, offset, voice), delay: voice.delay });
    }
  }

  /** Brings the voice in mid-loop, at the position the music is at. */
  private startVoiceNow(): void {
    if (!this.running || this.spin || !this.context) return;
    const offset = this.loopStep * this.stepDuration;
    this.startVoice(this.nextTime, offset);
  }

  private stopVoice(time: number): void {
    const sources = [...(this.voiceSource ? [{ source: this.voiceSource, delay: 0 }] : []), ...this.choirSources];
    this.voiceSource = null;
    this.choirSources = [];
    for (const { source, delay } of sources) {
      try {
        source.stop(Math.max(time + delay, this.context?.currentTime ?? 0));
      } catch {
        // Already stopped.
      }
    }
  }

  private playReel(reel: ReelId, loopStep: number, time: number, stepDuration: number, step: number, section: Section, level: number): void {
    const synth = this.synth!;
    const loop = this.loop;
    const chaos = this.settings.knobs.chaos;
    const up = section.transpose;
    const inBar = loopStep % 16;
    // Chaos above a third starts stuttering single steps, hyperpop style.
    const glitch = chaos > 0.3 && chance(step, 1) < (chaos - 0.3) * 0.3;
    switch (reel) {
      case "beat": {
        for (const hit of loop.beat[loopStep]!) {
          if (section.beat === "light" && !LIGHT_BEAT.has(hit.voice)) continue;
          const ratchet = glitch && hit.voice !== "kick" ? Math.max(hit.ratchet, 3) : hit.ratchet;
          synth.drum(hit.voice, time, hit.vel * level, ratchet, stepDuration);
        }
        if (section.beat === "full") synth.drum("shaker", time, (inBar % 2 === 0 ? 0.5 : 0.3) * level, 1, stepDuration);
        if (section.build && this.sectionBar === section.bars - 1 && inBar >= 8) {
          // The snare roll into the next section, getting louder and faster.
          synth.drum("snare", time, 0.35 + (inBar - 8) * 0.09, inBar >= 12 ? 2 : 1, stepDuration);
        }
        break;
      }
      case "chords":
        for (const hit of loop.chords[loopStep]!) synth.chord(loop.chordSound, hit.pitches.map((pitch) => pitch + up), time, hit.len * stepDuration, hit.vel * level);
        break;
      case "hook":
        if (section.chop) {
          // The drop chops the hook into sixteenths, jumping up an octave now and then.
          const pitch = loop.melody[loopStep];
          if (pitch !== null && pitch !== undefined) synth.hook(loop.hookSound, pitch + up + (inBar % 8 === 6 ? 12 : 0), time, stepDuration * 0.8, (inBar % 2 === 0 ? 0.9 : 0.55) * level);
          break;
        }
        for (const note of loop.hook[loopStep]!) {
          const jump = chaos > 0.5 && chance(step, 2) < (chaos - 0.5) * 0.4 ? 12 : 0;
          if (glitch) {
            const repeats = 2 + Math.floor(chance(step, 3) * 3);
            for (let hit = 0; hit < repeats; hit += 1) {
              synth.hook(loop.hookSound, note.pitch + up + (hit % 2) * 12, time + (hit * stepDuration) / repeats, (stepDuration / repeats) * 0.8, note.vel * 0.9 * level);
            }
          } else {
            synth.hook(loop.hookSound, note.pitch + up + jump, time, note.len * stepDuration, note.vel * level);
          }
        }
        break;
      case "bass":
        for (const note of loop.bass[loopStep]!) synth.bass(loop.bassSound, note.pitch + up, time, note.len * stepDuration, note.vel * level, note.glide);
        break;
    }
  }

  private playSparkle(loopStep: number, time: number, up: number, level: number): void {
    const glitter = this.settings.knobs.glitter;
    const every = glitter > 0.66 ? 1 : glitter > 0.4 ? 2 : glitter > 0.18 ? 4 : 0;
    if (every === 0 || loopStep % every !== 0) return;
    for (const note of this.loop.sparkle[loopStep]!) this.synth!.sparkle(note.pitch + up, time, note.vel * (0.5 + glitter * 0.6) * level);
  }

  /** The sound of a reel slamming into place: its part, played once on the beat. */
  private stopHit(reel: ReelId, loop: LoopData, time: number, stepDuration: number): void {
    const synth = this.synth!;
    const harmony = loop.harmony[0]!;
    switch (reel) {
      case "beat":
        synth.drum("kick", time, 1, 1, stepDuration);
        synth.drum("clap", time, 0.8, 1, stepDuration);
        break;
      case "chords":
        synth.chord(loop.chordSound, harmony.voicing, time, stepDuration * 2, 0.9);
        break;
      case "hook": {
        const note = firstNote(loop.hook);
        if (note) synth.hook(loop.hookSound, note.pitch, time, stepDuration * 2, 0.95);
        break;
      }
      case "bass":
        synth.bass(loop.bassSound, harmony.bassRoot, time, stepDuration * 3, 1, false);
        break;
    }
  }
}
