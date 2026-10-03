import type { ChannelBus, OscSpec, Patch } from "klangwerk";
import {
  clamp01, clap, crash, createBus, createEcho, createReverb, crushCurve, driveCurve, duck, fmBell, fmPiano, hallImpulse, harmonicWave, kick, Kit as Parts, Master, midiToHz,
  noiseHit, pulseWave, snare, toneHit, voice,
} from "klangwerk";
import type { BassSound, ChordSound, DrumVoice, HookSound, Kit } from "../music/reels";

/*
 * Every sound of Jackpop, on the Klangwerk engine: a node graph per note
 * that frees itself when the note ends, channel buses with reverb and delay
 * sends, kick pumping, and a master that never clips.
 */

export const BUSES = ["beat", "chords", "hook", "bass", "sparkle", "fx", "voice"] as const;
export type Bus = (typeof BUSES)[number];

export interface Knobs {
  /** Zucker: brighter, sweeter, a bell doubling the hook. */
  sugar: number;
  /** Glitzer: reverb, delay and the bell arpeggios. */
  glitter: number;
  /** Chaos: drive, bit crushing and stutters. */
  chaos: number;
}

const BUS_LEVELS: Record<Bus, number> = { beat: 0.85, chords: 0.36, hook: 0.55, bass: 0.22, sparkle: 0.3, fx: 0.45, voice: 0.62 };
const REVERB_SENDS: Record<Bus, number> = { beat: 0.06, chords: 0.2, hook: 0.18, bass: 0, sparkle: 0.45, fx: 0.25, voice: 0.2 };
const DELAY_SENDS: Record<Bus, number> = { beat: 0, chords: 0.06, hook: 0.16, bass: 0, sparkle: 0.3, fx: 0.08, voice: 0.22 };
/** How far the kick pushes each bus down (pop pumping). */
const PUMP_DEPTHS: Partial<Record<Bus, number>> = { chords: 0.45, hook: 0.3, bass: 0.35, sparkle: 0.45, voice: 0.2 };
/** Jackpop's vibrato: a little earlier, quicker and faster than the engine's. */
const VIBRATO = { delay: 0.16, rise: 0.15, rate: 5.6, tail: 0.2 };

type Wave = "organ" | "sub" | "pulse";

export class PopSynth {
  readonly context: BaseAudioContext;
  private readonly parts: Parts<Wave>;
  private readonly master: Master;
  private readonly buses: Record<Bus, ChannelBus<"reverb" | "delay">>;
  private readonly shelf: BiquadFilterNode;
  private readonly crushDry: GainNode;
  private readonly crushWet: GainNode;
  private readonly delayNode: DelayNode;
  private knobs: Knobs = { sugar: 0.5, glitter: 0.35, chaos: 0.2 };
  private kit: Kit = "bubble";
  private bassSound: BassSound = "square";
  private lastBassPitch: number | null = null;
  private lastDrive = { beat: -1, bass: -1 };

  constructor(context: BaseAudioContext, destination: AudioNode = context.destination) {
    this.context = context;
    const parts = new Parts(context, {
      waves: {
        organ: harmonicWave(context, [1, 0.75, 0.5, 0.32, 0, 0.22, 0, 0.14]),
        sub: harmonicWave(context, [1, 0.38, 0.16]),
        // A 25 % pulse: the classic chip lead.
        pulse: pulseWave(context, 0.25),
      },
    });
    this.parts = parts;

    // ---- master: gate, sugar shelf, chaos bit crusher (dry and wet), dynamics
    this.shelf = context.createBiquadFilter();
    this.shelf.type = "highshelf";
    this.shelf.frequency.value = 6000;
    this.crushDry = context.createGain();
    this.crushWet = parts.gain(0);
    const crusher = context.createWaveShaper();
    crusher.curve = crushCurve(5);
    const crushed = context.createGain();
    this.shelf.connect(this.crushDry).connect(crushed);
    this.shelf.connect(crusher).connect(this.crushWet).connect(crushed);
    this.master = new Master(context, { destination, chain: ["gate", { input: this.shelf, output: crushed }], open: true, compressor: { attack: 0.005 } });
    const master = this.master.input;

    const reverb = createReverb(parts, hallImpulse(context, 2.4, { damping: 0.15, predelay: 0.018, decay: 4.2 }), { level: 0.9, to: master });
    const echo = createEcho(parts, { time: 0.3, feedback: 0.36, tone: 3200, q: 1, level: 0.7, to: master });
    this.delayNode = echo.delay;

    this.buses = Object.fromEntries(BUSES.map((bus) => [bus, createBus(context, {
      level: BUS_LEVELS[bus],
      drive: bus === "beat" || bus === "bass",
      to: master,
      sends: { reverb: reverb.input, delay: echo.input },
    })])) as Record<Bus, ChannelBus<"reverb" | "delay">>;
    this.applyKnobs(context.currentTime, true);
  }

  // ---- settings ---------------------------------------------------------

  setKnobs(knobs: Knobs, time = this.context.currentTime): void {
    this.knobs = { sugar: clamp01(knobs.sugar), glitter: clamp01(knobs.glitter), chaos: clamp01(knobs.chaos) };
    this.applyKnobs(time, false);
  }

  setSounds(kit: Kit, bassSound: BassSound): void {
    this.kit = kit;
    this.bassSound = bassSound;
    this.applyDrive();
  }

  setVolume(volume: number, time = this.context.currentTime): void {
    this.master.setVolume(volume, time);
  }

  setTempo(bpm: number, time = this.context.currentTime): void {
    // A dotted eighth: the pop delay.
    this.delayNode.delayTime.setTargetAtTime(Math.min(1.9, (60 / bpm) * 0.75), time, 0.05);
  }

  open(time: number): void {
    this.master.open(time);
  }

  close(time: number): void {
    this.master.close(time);
    this.lastBassPitch = null;
  }

  /** Brightness factor for filters, from the sugar knob. */
  private get bright(): number {
    return 0.55 + this.knobs.sugar * 0.9;
  }

  private applyKnobs(time: number, immediate: boolean): void {
    const { sugar, glitter, chaos } = this.knobs;
    const set = (param: AudioParam, value: number) => (immediate ? param.setValueAtTime(value, time) : param.setTargetAtTime(value, time, 0.04));
    const space = 0.3 + glitter * 1.6;
    for (const bus of BUSES) {
      set(this.buses[bus].sends.reverb.gain, REVERB_SENDS[bus] * space);
      set(this.buses[bus].sends.delay.gain, DELAY_SENDS[bus] * space);
    }
    set(this.shelf.gain, -2 + sugar * 7);
    const crush = clamp01((chaos - 0.45) / 0.55) * 0.55;
    set(this.crushWet.gain, crush);
    set(this.crushDry.gain, 1 - crush * 0.7);
    this.applyDrive();
  }

  private applyDrive(): void {
    const chaos = this.knobs.chaos;
    const beat = (this.kit === "hyper" ? 0.35 : 0.08) + chaos * 0.6;
    const bass = (this.bassSound === "808" ? 0.3 : 0.12) + chaos * 0.5;
    if (Math.abs(beat - this.lastDrive.beat) > 0.02) {
      this.buses.beat.drive!.curve = driveCurve(beat);
      this.lastDrive.beat = beat;
    }
    if (Math.abs(bass - this.lastDrive.bass) > 0.02) {
      this.buses.bass.drive!.curve = driveCurve(bass);
      this.lastDrive.bass = bass;
    }
  }

  get sugar(): number {
    return this.knobs.sugar;
  }

  // ---- drums ------------------------------------------------------------

  drum(voice: DrumVoice, time: number, vel: number, ratchet: number, stepDuration: number): void {
    const hits = Math.max(1, ratchet);
    for (let hit = 0; hit < hits; hit += 1) {
      const at = time + (hit * stepDuration) / hits;
      const level = vel * (hit === 0 ? 1 : 0.78);
      this.drumHit(voice, at, level);
    }
  }

  private drumHit(voice: DrumVoice, time: number, velocity: number): void {
    const parts = this.parts;
    const out = this.buses.beat.input;
    const kit = this.kit;
    // The soft kit plays gentler sounds; it is lifted so it holds its own in the mix.
    const vel = velocity * (kit === "soft" ? 1.3 : 1);
    switch (voice) {
      case "kick": {
        const decay = kit === "hyper" ? 0.46 : kit === "soft" ? 0.24 : 0.32;
        kick(parts, out, time, {
          top: kit === "hyper" ? 210 : kit === "soft" ? 120 : 160,
          bottom: kit === "hyper" ? 44 : 52,
          sweep: 0.075,
          decay,
          level: vel * 1.05,
          knock: { frequency: 115, level: vel * (kit === "soft" ? 0.08 : 0.16) },
          click: { tone: 3200, level: vel * (kit === "soft" ? 0.1 : 0.28) },
        });
        this.pump(time);
        break;
      }
      case "snare":
        snare(parts, out, time, {
          top: 190,
          bottom: 150,
          bodyLevel: vel * 0.5,
          bodyDecay: 0.11,
          noise: 0.2,
          filter: [kit === "soft" ? "bandpass" : "highpass", kit === "soft" ? 2200 : 1500],
          level: vel * 0.62,
          decay: kit === "hyper" ? 0.2 : 0.15,
        });
        break;
      case "clap":
        clap(parts, out, time, { frequency: 1250, burst: vel * 0.9, floor: vel * 0.12, level: vel * 0.7, tail: kit === "soft" ? 0.16 : 0.24 });
        break;
      case "hat":
      case "openhat": {
        const open = voice === "openhat";
        noiseHit(parts, out, time, {
          duration: open ? 0.4 : 0.08,
          filters: [["highpass", kit === "hyper" ? 6200 : kit === "soft" ? 8800 : 7400]],
          peak: vel * (open ? 0.32 : 0.36),
          decay: open ? 0.28 : kit === "soft" ? 0.025 : 0.038,
          attack: 0.001,
        });
        break;
      }
      case "snap":
        toneHit(parts, out, time, { wave: "sine", frequency: 1850, peak: vel * 0.25, decay: 0.018, attack: 0.0005, length: 0.05, tail: 0 });
        noiseHit(parts, out, time, { duration: 0.08, filters: [["bandpass", 3000, 1.4]], peak: vel * 0.55, decay: 0.05, attack: 0.001 });
        break;
      case "shaker":
        noiseHit(parts, out, time, { duration: 0.1, filters: [["bandpass", 6500, 1.3]], peak: vel * 0.3, decay: 0.055, attack: 0.008 });
        break;
      case "tom":
        toneHit(parts, out, time, { wave: "sine", frequency: 190, drop: { to: 105, time: 0.18 }, peak: vel * 0.8, decay: 0.26, length: 0.32, tail: 0 });
        break;
    }
  }

  /** Kick pumping: the other buses duck and swell back, the breathing of pop. */
  pump(time: number): void {
    for (const [bus, depth] of Object.entries(PUMP_DEPTHS) as [Bus, number][]) duck(this.buses[bus].pump.gain, time, depth, { hold: 0.03, release: 0.07 });
  }

  crash(time: number, vel = 0.5): void {
    crash(this.parts, this.buses.fx.input, time, vel * 0.42, 1.5);
  }

  // ---- chords -----------------------------------------------------------

  chord(sound: ChordSound, pitches: readonly number[], time: number, duration: number, vel: number): void {
    const parts = this.parts;
    const out = this.buses.chords.input;
    const level = (vel * 0.9) / Math.sqrt(Math.max(1, pitches.length));
    const bright = this.bright;
    switch (sound) {
      case "pluck":
        voice(parts, out, time, {
          oscs: pitches.map((pitch) => ({ wave: "sawtooth", frequency: midiToHz(pitch) })),
          filter: { type: "lowpass", frequency: 900 * bright, q: 2, env: [["set", 5200 * bright, 0], ["target", 900 * bright, 0.005, 0.07]] },
          amp: { strike: [level * 2.4, Math.max(0.22, Math.min(duration, 0.5)), 0.003], length: Math.max(0.25, Math.min(duration, 0.5)) },
          duration,
        });
        break;
      case "bell":
        for (const pitch of pitches) this.bell(pitch, time, level * 0.9, 1.1, 3.5, out);
        break;
      case "supersaw": {
        const pad = duration >= 0.6;
        voice(parts, out, time, {
          oscs: pitches.flatMap((pitch) => [-14, 0, 14].map((cents): OscSpec<Wave> => ({ wave: "sawtooth", frequency: midiToHz(pitch), detune: cents }))),
          filter: pad
            ? { type: "lowpass", frequency: 2600 * bright, q: 0.9 }
            : { type: "lowpass", frequency: 3800 * bright, q: 0.9, env: [["set", 6500 * bright, 0], ["target", 2800 * bright, 0.01, 0.08]] },
          amp: pad ? { hold: [level * 0.7, duration, 0.06, 0.85, 0.3, 0.35] } : { hold: [level * 1.2, duration, 0.004, 0.35, 0.18, 0.08] },
          duration,
        });
        break;
      }
      case "epiano":
        for (const pitch of pitches) {
          const frequency = midiToHz(pitch);
          fmPiano(parts, out, time, { frequency, index: frequency * 1.8 * bright, level: level * 0.8, duration });
        }
        break;
      case "organ":
        voice(parts, out, time, {
          oscs: pitches.map((pitch) => ({ wave: "organ", frequency: midiToHz(pitch) })),
          filter: { type: "lowpass", frequency: 4200 * bright },
          amp: { hold: [level * 0.8, duration, 0.004, 0.75, 0.12, 0.06] },
          duration,
        });
        break;
      case "pad":
        voice(parts, out, time, {
          oscs: pitches.flatMap((pitch): OscSpec<Wave>[] => [
            { wave: "sawtooth", frequency: midiToHz(pitch), detune: -8 },
            { wave: "sawtooth", frequency: midiToHz(pitch), detune: 8 },
            { wave: "triangle", frequency: midiToHz(pitch - 12) },
          ]),
          filter: { type: "lowpass", frequency: 1700 * bright, q: 0.6 },
          amp: { hold: [level * 0.75, duration, 0.28, 0.9, 0.5, 0.7] },
          duration,
        });
        break;
    }
  }

  /** The FM bell of chords, hooks, sparkles and the jingle. */
  private bell(pitch: number, time: number, level: number, decay: number, ratio: number, out: AudioNode): void {
    const frequency = midiToHz(pitch);
    fmBell(this.parts, out, time, { frequency, index: frequency * 2.2, ratio, level, decay });
  }

  // ---- hook -------------------------------------------------------------

  hook(sound: HookSound, pitch: number, time: number, duration: number, vel: number): void {
    const parts = this.parts;
    const out = this.buses.hook.input;
    const frequency = midiToHz(pitch);
    const level = vel * 0.55;
    const bright = this.bright;
    const patches: Record<Exclude<HookSound, "bell">, Patch<Wave>> = {
      chip: {
        oscs: [{ wave: "pulse", frequency, vibrato: { ...VIBRATO, cents: 14 } }],
        filter: { type: "lowpass", frequency: 6500 * bright },
        amp: { hold: [level * 1.45, duration * 0.92, 0.003, 0.72, 0.1, 0.05] },
        duration,
      },
      saw: {
        oscs: [-10, 0, 10].map((cents) => ({ wave: "sawtooth", frequency, detune: cents })),
        filter: { type: "lowpass", frequency: 4200 * bright, q: 1.2, env: [["set", 7000 * bright, 0], ["target", 3600 * bright, 0.01, 0.1]] },
        amp: { hold: [level * 0.55, duration * 0.95, 0.004, 0.8, 0.12, 0.09] },
        duration,
      },
      flute: {
        oscs: [{ wave: "triangle", frequency, vibrato: { ...VIBRATO, cents: 18, delay: 0.22 } }, { wave: "sine", frequency: frequency * 2, level: 0.12 }],
        filter: { type: "lowpass", frequency: 3200 * bright },
        amp: { hold: [level * 0.65, duration * 0.95, 0.035, 0.85, 0.2, 0.12] },
        duration,
      },
      pluck: {
        oscs: [{ wave: "sawtooth", frequency }],
        filter: { type: "lowpass", frequency: 1200 * bright, q: 3, env: [["set", 6000 * bright, 0], ["target", 1000 * bright, 0.004, 0.06]] },
        amp: { strike: [level * 2.9, Math.max(0.2, Math.min(duration, 0.45)), 0.002], length: 0.5, tail: 0 },
        duration,
      },
    };
    if (sound === "bell") {
      this.bell(pitch, time, level * 1.05, 0.9, 3.5, out);
    } else {
      voice(parts, out, time, patches[sound]);
      // The flute breathes in.
      if (sound === "flute") noiseHit(parts, out, time, { duration: 0.12, filters: [["bandpass", 2400, 1.5]], peak: level * 0.12, decay: 0.08, attack: 0.01 });
    }
    // Sugar above half adds a bell an octave up: sweeter, more toy-like.
    const double = clamp01((this.knobs.sugar - 0.5) * 2);
    if (double > 0.02 && sound !== "bell") fmBell(parts, this.buses.sparkle.input, time, { frequency: midiToHz(pitch + 12), index: midiToHz(pitch + 12) * 2.2, ratio: 4, level: level * 0.3 * double, decay: 0.5 });
  }

  // ---- bass -------------------------------------------------------------

  bass(sound: BassSound, pitch: number, time: number, duration: number, vel: number, glide: boolean): void {
    const frequency = midiToHz(pitch);
    const level = vel * 0.8;
    const from = glide && this.lastBassPitch !== null ? midiToHz(this.lastBassPitch) : null;
    this.lastBassPitch = pitch;
    const patches: Record<BassSound, Patch<Wave>> = {
      square: {
        oscs: [{ wave: "square", frequency }],
        filter: { type: "lowpass", frequency: 1300, q: 1.5, env: [["set", 2400, 0], ["target", 900, 0.005, 0.06]] },
        amp: { hold: [level * 0.42, duration * 0.9, 0.003, 0.75, 0.1, 0.04] },
        duration,
      },
      sub: {
        oscs: [{ wave: "sub", frequency }],
        amp: { hold: [level * 0.95, duration * 0.95, 0.008, 0.9, 0.2, 0.08] },
        duration,
      },
      // The 808 drops into its note, or slides from the last one.
      "808": {
        oscs: [{ wave: "sine", frequency, glide: from ? { from, time: 0.07 } : { from: frequency * 1.9, time: 0.035 } }],
        amp: { hold: [level * 1.05, Math.max(duration, 0.18), 0.002, 0.8, 0.6, 0.12] },
        duration,
      },
      saw: {
        oscs: [{ wave: "sawtooth", frequency }],
        filter: { type: "lowpass", frequency: 500, q: 4, env: [["set", 2300, 0], ["target", 480, 0.004, 0.05]] },
        amp: { hold: [level * 1.2, duration * 0.85, 0.002, 0.6, 0.1, 0.035] },
        duration,
      },
    };
    voice(this.parts, this.buses.bass.input, time, patches[sound]);
  }

  // ---- the voice from the coin slot ---------------------------------------

  /** Plays the tuned voice (one loop long) from `offset` seconds into it. */
  voice(buffer: AudioBuffer, time: number, offset = 0): AudioBufferSourceNode {
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.buses.voice.input);
    source.start(time, Math.max(0, Math.min(buffer.duration - 0.001, offset)));
    return source;
  }

  /** A choir voice: the tuned take again, quieter, off to one side and a few milliseconds late. */
  choir(buffer: AudioBuffer, time: number, offset: number, voice: { pan: number; level: number; delay: number }): AudioBufferSourceNode {
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    const amp = this.parts.gain(voice.level);
    const panner = this.context.createStereoPanner();
    panner.pan.value = voice.pan;
    source.connect(amp).connect(panner).connect(this.buses.voice.input);
    source.start(time + voice.delay, Math.max(0, Math.min(buffer.duration - 0.001, offset)));
    return source;
  }

  /** The machine grumbling after another pull without a jackpot. */
  grumble(time: number): void {
    [[330, 0], [247, 0.12]].forEach(([frequency, offset]) => {
      toneHit(this.parts, this.buses.fx.input, time + offset!, {
        wave: "square", frequency: frequency!, drop: { to: frequency! * 0.85, time: 0.12 }, filters: [["lowpass", 1400]], peak: 0.07, decay: 0.12, attack: 0.004, length: 0.18, tail: 0,
      });
    });
  }

  /** A coin dropping into the slot: the voice is in. */
  coin(time: number): void {
    [0, 0.07, 0.15].forEach((offset, index) => {
      toneHit(this.parts, this.buses.fx.input, time + offset, { wave: "triangle", frequency: [2349, 3136, 2637][index]!, peak: 0.16, decay: 0.2, attack: 0.001, length: 0.25, tail: 0 });
    });
    this.clack(time + 0.24);
  }

  // ---- glitter ----------------------------------------------------------

  sparkle(pitch: number, time: number, vel: number): void {
    this.bell(pitch, time, vel * 0.3, 0.32, 4, this.buses.sparkle.input);
  }

  // ---- the machine itself -----------------------------------------------

  /** One click of the lever's ratchet; higher as the lever goes down. */
  ratchet(time: number, depth: number): void {
    const out = this.buses.fx.input;
    noiseHit(this.parts, out, time, { duration: 0.02, filters: [["highpass", 2400]], peak: 0.22, decay: 0.012, attack: 0.0005 });
    toneHit(this.parts, out, time, { wave: "square", frequency: 700 + depth * 1100, peak: 0.05, decay: 0.02, attack: 0.0005, length: 0.04, tail: 0 });
  }

  /** A reel slamming into place. */
  clack(time: number): void {
    const out = this.buses.fx.input;
    toneHit(this.parts, out, time, { wave: "sine", frequency: 150, drop: { to: 80, time: 0.04 }, peak: 0.35, decay: 0.05, attack: 0.001, length: 0.08, tail: 0 });
    noiseHit(this.parts, out, time, { duration: 0.05, filters: [["bandpass", 1900, 2]], peak: 0.5, decay: 0.03, attack: 0.0005 });
  }

  /** The reels rattling past while they spin. */
  tick(time: number, level = 0.1): void {
    noiseHit(this.parts, this.buses.fx.input, time, { duration: 0.01, filters: [["highpass", 4200]], peak: level, decay: 0.006, attack: 0.0005 });
  }

  /** A hold button locking in. */
  clunk(time: number): void {
    toneHit(this.parts, this.buses.fx.input, time, { wave: "sine", frequency: 95, peak: 0.4, decay: 0.07, attack: 0.001, length: 0.1, tail: 0 });
    this.tick(time, 0.2);
  }

  /** The spin: rising noise and a sweeping saw, ending exactly on the drop. */
  riser(start: number, end: number): void {
    const parts = this.parts;
    const length = Math.max(0.1, end - start);
    const source = parts.noiseSource(start, length);
    const tone = parts.filter("bandpass", 300, 3);
    tone.frequency.setValueAtTime(300, start);
    tone.frequency.exponentialRampToValueAtTime(7500, end);
    const amp = parts.gain();
    amp.gain.setValueAtTime(0.0001, start);
    amp.gain.exponentialRampToValueAtTime(0.32, end - 0.01);
    amp.gain.linearRampToValueAtTime(0, end);
    source.connect(tone).connect(amp).connect(this.buses.fx.input);
    const sweep = parts.osc("sawtooth", 110);
    sweep.frequency.setValueAtTime(110, start);
    sweep.frequency.exponentialRampToValueAtTime(880, end);
    const sweepTone = parts.filter("lowpass", 2000);
    const sweepAmp = parts.gain();
    sweepAmp.gain.setValueAtTime(0.0001, start);
    sweepAmp.gain.exponentialRampToValueAtTime(0.06, end - 0.01);
    sweepAmp.gain.linearRampToValueAtTime(0, end);
    sweep.connect(sweepTone).connect(sweepAmp).connect(this.buses.fx.input);
    parts.stopAll([sweep], start, end + 0.02);
  }

  /** The jackpot: a bell run up through the chord and a shower of coin dings. */
  jingle(time: number, voicing: readonly number[], stepDuration: number): void {
    const up = [...voicing].sort((a, b) => a - b).map((pitch) => pitch + 12);
    const run = [...up, ...up.map((pitch) => pitch + 12)];
    run.forEach((pitch, index) => this.bell(pitch, time + index * stepDuration * 0.5, 0.28, 0.6, 3.5, this.buses.fx.input));
    const coins = time + run.length * stepDuration * 0.5;
    for (let index = 0; index < 6; index += 1) {
      const at = coins + index * stepDuration * 0.5;
      toneHit(this.parts, this.buses.fx.input, at, { wave: "triangle", frequency: index % 2 === 0 ? 1976 : 2637, peak: 0.12, decay: 0.18, attack: 0.001, length: 0.22, tail: 0 });
    }
    this.crash(time, 0.7);
  }
}
