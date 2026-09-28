import type { BassSound, ChordSound, DrumVoice, HookSound, Kit } from "../music/reels";
import { midiToHz } from "../music/theory";

/*
 * Every sound of Jackpop, synthesized from native Web Audio nodes: a node
 * graph per note that frees itself when the note ends, channel buses with
 * reverb and delay sends, kick pumping, and a master that never clips.
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

interface ChannelBus {
  input: GainNode;
  drive: WaveShaperNode | null;
  pump: GainNode;
  output: GainNode;
  reverb: GainNode;
  delay: GainNode;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * Saturation that leaves quiet signals at about their level and rounds off
 * the loud ones: more drive means more grit, not more volume.
 */
function driveCurve(amount: number): Float32Array<ArrayBuffer> {
  const k = 1 + amount * 9;
  const makeup = 1 + 0.25 * Math.sqrt(k - 1);
  const curve = new Float32Array(2048);
  for (let index = 0; index < curve.length; index += 1) {
    const x = (index / (curve.length - 1)) * 2 - 1;
    curve[index] = (Math.tanh(k * x) / k) * makeup;
  }
  return curve;
}

/** A soft ceiling at 0.98: whatever reaches it, the output never clips. */
function ceilingCurve(): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(4096);
  for (let index = 0; index < curve.length; index += 1) {
    const x = (index / (curve.length - 1)) * 4 - 2;
    const magnitude = Math.abs(x);
    const shaped = magnitude < 0.7 ? magnitude : 0.7 + 0.28 * Math.tanh((magnitude - 0.7) / 0.28);
    curve[index] = Math.sign(x) * Math.min(0.98, shaped);
  }
  return curve;
}

function crushCurve(bits: number): Float32Array<ArrayBuffer> {
  const levels = 2 ** bits;
  const curve = new Float32Array(8192);
  for (let index = 0; index < curve.length; index += 1) {
    const x = (index / (curve.length - 1)) * 2 - 1;
    curve[index] = Math.round(x * levels) / levels;
  }
  return curve;
}

function periodicWave(context: BaseAudioContext, harmonics: number[]): PeriodicWave {
  const real = new Float32Array(harmonics.length + 1);
  const imag = new Float32Array(harmonics.length + 1);
  harmonics.forEach((amplitude, index) => { imag[index + 1] = amplitude; });
  return context.createPeriodicWave(real, imag);
}

export class PopSynth {
  readonly context: BaseAudioContext;
  private readonly noise: AudioBuffer;
  private readonly waves: { organ: PeriodicWave; sub: PeriodicWave; pulse: PeriodicWave };
  private readonly buses: Record<Bus, ChannelBus>;
  private readonly master: GainNode;
  private readonly gate: GainNode;
  private readonly shelf: BiquadFilterNode;
  private readonly crushDry: GainNode;
  private readonly crushWet: GainNode;
  private readonly volumeGain: GainNode;
  private readonly delayNode: DelayNode;
  private knobs: Knobs = { sugar: 0.5, glitter: 0.35, chaos: 0.2 };
  private kit: Kit = "bubble";
  private bassSound: BassSound = "square";
  private lastBassPitch: number | null = null;
  private lastDrive = { beat: -1, bass: -1 };

  constructor(context: BaseAudioContext, destination: AudioNode = context.destination) {
    this.context = context;
    this.noise = this.makeNoise();
    this.waves = {
      organ: periodicWave(context, [1, 0.75, 0.5, 0.32, 0, 0.22, 0, 0.14]),
      sub: periodicWave(context, [1, 0.38, 0.16]),
      // A 25 % pulse: the classic chip lead.
      pulse: periodicWave(context, Array.from({ length: 24 }, (_, index) => (2 / (Math.PI * (index + 1))) * Math.sin(Math.PI * (index + 1) * 0.25))),
    };

    this.master = context.createGain();
    this.gate = context.createGain();
    this.shelf = context.createBiquadFilter();
    this.shelf.type = "highshelf";
    this.shelf.frequency.value = 6000;
    this.crushDry = context.createGain();
    this.crushWet = context.createGain();
    this.crushWet.gain.value = 0;
    const crusher = context.createWaveShaper();
    crusher.curve = crushCurve(5);
    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -14;
    compressor.knee.value = 8;
    compressor.ratio.value = 3;
    compressor.attack.value = 0.005;
    compressor.release.value = 0.2;
    // The browser's compressor adds its own makeup gain (about +5.6 dB at these
    // settings, the limiter another +1.1 dB); this takes it back out.
    const makeup = context.createGain();
    makeup.gain.value = 0.5;
    const limiter = context.createDynamicsCompressor();
    limiter.threshold.value = -2;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.001;
    limiter.release.value = 0.08;
    const ceiling = context.createWaveShaper();
    ceiling.curve = ceilingCurve();
    this.volumeGain = context.createGain();

    this.master.connect(this.gate);
    this.gate.connect(this.shelf);
    this.shelf.connect(this.crushDry);
    this.shelf.connect(crusher);
    crusher.connect(this.crushWet);
    this.crushDry.connect(compressor);
    this.crushWet.connect(compressor);
    compressor.connect(makeup);
    makeup.connect(limiter);
    limiter.connect(this.volumeGain);
    this.volumeGain.connect(ceiling);
    ceiling.connect(destination);

    const reverb = context.createConvolver();
    reverb.buffer = this.makeImpulse(2.4);
    const reverbReturn = context.createGain();
    reverbReturn.gain.value = 0.9;
    reverb.connect(reverbReturn);
    reverbReturn.connect(this.master);

    this.delayNode = context.createDelay(2);
    this.delayNode.delayTime.value = 0.3;
    const feedback = context.createGain();
    feedback.gain.value = 0.36;
    const delayTone = context.createBiquadFilter();
    delayTone.type = "lowpass";
    delayTone.frequency.value = 3200;
    this.delayNode.connect(delayTone);
    delayTone.connect(feedback);
    feedback.connect(this.delayNode);
    const delayReturn = context.createGain();
    delayReturn.gain.value = 0.7;
    delayTone.connect(delayReturn);
    delayReturn.connect(this.master);

    this.buses = Object.fromEntries(BUSES.map((bus) => {
      const input = context.createGain();
      const drive = bus === "beat" || bus === "bass" ? context.createWaveShaper() : null;
      const pump = context.createGain();
      const output = context.createGain();
      output.gain.value = BUS_LEVELS[bus];
      const reverbSend = context.createGain();
      const delaySend = context.createGain();
      if (drive) {
        input.connect(drive);
        drive.connect(pump);
      } else {
        input.connect(pump);
      }
      pump.connect(output);
      output.connect(this.master);
      output.connect(reverbSend);
      output.connect(delaySend);
      reverbSend.connect(reverb);
      delaySend.connect(this.delayNode);
      return [bus, { input, drive, pump, output, reverb: reverbSend, delay: delaySend }];
    })) as Record<Bus, ChannelBus>;
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
    this.volumeGain.gain.setTargetAtTime(clamp01(volume) ** 1.6, time, 0.02);
  }

  setTempo(bpm: number, time = this.context.currentTime): void {
    // A dotted eighth: the pop delay.
    this.delayNode.delayTime.setTargetAtTime(Math.min(1.9, (60 / bpm) * 0.75), time, 0.05);
  }

  open(time: number): void {
    this.gate.gain.cancelScheduledValues(time);
    this.gate.gain.setValueAtTime(1, time);
  }

  close(time: number): void {
    this.gate.gain.cancelScheduledValues(time);
    this.gate.gain.setTargetAtTime(0, time, 0.025);
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
      set(this.buses[bus].reverb.gain, REVERB_SENDS[bus] * space);
      set(this.buses[bus].delay.gain, DELAY_SENDS[bus] * space);
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

  // ---- building blocks --------------------------------------------------

  private makeNoise(): AudioBuffer {
    const length = Math.floor(this.context.sampleRate * 2);
    const buffer = this.context.createBuffer(1, length, this.context.sampleRate);
    const data = buffer.getChannelData(0);
    let seed = 22_222;
    for (let index = 0; index < length; index += 1) {
      seed = (seed * 16_807) % 2_147_483_647;
      data[index] = (seed / 2_147_483_647) * 2 - 1;
    }
    return buffer;
  }

  private makeImpulse(seconds: number): AudioBuffer {
    const rate = this.context.sampleRate;
    const length = Math.floor(rate * seconds);
    const buffer = this.context.createBuffer(2, length, rate);
    let seed = 1_234_567;
    for (let channel = 0; channel < 2; channel += 1) {
      const data = buffer.getChannelData(channel);
      let smooth = 0;
      for (let index = 0; index < length; index += 1) {
        seed = (seed * 16_807) % 2_147_483_647;
        const white = (seed / 2_147_483_647) * 2 - 1;
        // Later reflections get darker: a one-pole lowpass that closes over time.
        const damping = 0.15 + 0.8 * (index / length);
        smooth += (white - smooth) * (1 - damping);
        const predelay = index < rate * 0.018 ? 0 : 1;
        data[index] = smooth * predelay * Math.exp((-4.2 * index) / length);
      }
    }
    return buffer;
  }

  private gain(value = 0): GainNode {
    const node = this.context.createGain();
    node.gain.value = value;
    return node;
  }

  private filter(type: BiquadFilterType, frequency: number, q = 0.7): BiquadFilterNode {
    const node = this.context.createBiquadFilter();
    node.type = type;
    node.frequency.value = frequency;
    node.Q.value = q;
    return node;
  }

  private osc(type: OscillatorType | "organ" | "sub" | "pulse", frequency: number, detune = 0): OscillatorNode {
    const node = this.context.createOscillator();
    if (type === "organ" || type === "sub" || type === "pulse") node.setPeriodicWave(this.waves[type]);
    else node.type = type;
    node.frequency.value = frequency;
    node.detune.value = detune;
    return node;
  }

  private noiseSource(time: number, duration: number): AudioBufferSourceNode {
    const source = this.context.createBufferSource();
    source.buffer = this.noise;
    const offset = ((time * 7.31) % 1.5) + 0.01;
    source.start(time, offset, duration + 0.05);
    return source;
  }

  /** Attack to `peak`, fall to zero over `decay`: a struck sound. */
  private strike(param: AudioParam, time: number, peak: number, decay: number, attack = 0.002): void {
    param.setValueAtTime(0, time);
    param.linearRampToValueAtTime(peak, time + attack);
    param.exponentialRampToValueAtTime(0.0001, time + attack + decay);
  }

  /** Attack, sustain while held, release: a played note. Returns when it is silent. */
  private hold(param: AudioParam, time: number, peak: number, duration: number, attack: number, sustain: number, decay: number, release: number): number {
    param.setValueAtTime(0, time);
    param.linearRampToValueAtTime(peak, time + attack);
    param.setTargetAtTime(peak * sustain, time + attack, Math.max(0.005, decay / 3));
    const end = time + Math.max(duration, attack + 0.01);
    param.setTargetAtTime(0, end, Math.max(0.005, release / 4));
    return end + release * 1.6;
  }

  private stopAll(nodes: (AudioScheduledSourceNode | null)[], time: number, end: number): void {
    for (const node of nodes) {
      if (!node) continue;
      if (!(node instanceof AudioBufferSourceNode)) node.start(time);
      node.stop(end);
    }
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
    const out = this.buses.beat.input;
    const kit = this.kit;
    // The soft kit plays gentler sounds; it is lifted so it holds its own in the mix.
    const vel = velocity * (kit === "soft" ? 1.3 : 1);
    switch (voice) {
      case "kick": {
        const top = kit === "hyper" ? 210 : kit === "soft" ? 120 : 160;
        const bottom = kit === "hyper" ? 44 : 52;
        const decay = kit === "hyper" ? 0.46 : kit === "soft" ? 0.24 : 0.32;
        const body = this.osc("sine", top);
        body.frequency.setValueAtTime(top, time);
        body.frequency.exponentialRampToValueAtTime(bottom, time + 0.075);
        const amp = this.gain();
        this.strike(amp.gain, time, vel * 1.05, decay, 0.001);
        body.connect(amp).connect(out);
        // The knock and click keep the kick audible on phone speakers, which cannot play its body.
        const knock = this.osc("square", 115);
        const knockTone = this.filter("lowpass", 900);
        const knockAmp = this.gain();
        this.strike(knockAmp.gain, time, vel * (kit === "soft" ? 0.08 : 0.16), 0.03, 0.001);
        knock.connect(knockTone).connect(knockAmp).connect(out);
        const click = this.noiseSource(time, 0.02);
        const clickTone = this.filter("highpass", 3200);
        const clickAmp = this.gain();
        this.strike(clickAmp.gain, time, vel * (kit === "soft" ? 0.1 : 0.28), 0.008, 0.0005);
        click.connect(clickTone).connect(clickAmp).connect(out);
        this.stopAll([body, knock], time, time + decay + 0.05);
        this.pump(time);
        break;
      }
      case "snare": {
        const body = this.osc("triangle", 190);
        body.frequency.setValueAtTime(190, time);
        body.frequency.exponentialRampToValueAtTime(150, time + 0.05);
        const bodyAmp = this.gain();
        this.strike(bodyAmp.gain, time, vel * 0.5, 0.11);
        body.connect(bodyAmp).connect(out);
        const rattle = this.noiseSource(time, 0.2);
        const tone = this.filter(kit === "soft" ? "bandpass" : "highpass", kit === "soft" ? 2200 : 1500);
        const amp = this.gain();
        this.strike(amp.gain, time, vel * 0.62, kit === "hyper" ? 0.2 : 0.15);
        rattle.connect(tone).connect(amp).connect(out);
        this.stopAll([body], time, time + 0.2);
        break;
      }
      case "clap": {
        const source = this.noiseSource(time, 0.3);
        const tone = this.filter("bandpass", 1250, 0.9);
        const amp = this.gain();
        const g = amp.gain;
        g.setValueAtTime(0, time);
        for (const offset of [0, 0.011, 0.022]) {
          g.setValueAtTime(vel * 0.9, time + offset);
          g.exponentialRampToValueAtTime(vel * 0.12, time + offset + 0.009);
        }
        g.setValueAtTime(vel * 0.7, time + 0.033);
        g.exponentialRampToValueAtTime(0.0001, time + (kit === "soft" ? 0.16 : 0.24));
        source.connect(tone).connect(amp).connect(out);
        break;
      }
      case "hat":
      case "openhat": {
        const open = voice === "openhat";
        const source = this.noiseSource(time, open ? 0.4 : 0.08);
        const tone = this.filter("highpass", kit === "hyper" ? 6200 : kit === "soft" ? 8800 : 7400);
        const amp = this.gain();
        this.strike(amp.gain, time, vel * (open ? 0.32 : 0.36), open ? 0.28 : kit === "soft" ? 0.025 : 0.038, 0.001);
        source.connect(tone).connect(amp).connect(out);
        break;
      }
      case "snap": {
        const ping = this.osc("sine", 1850);
        const pingAmp = this.gain();
        this.strike(pingAmp.gain, time, vel * 0.25, 0.018, 0.0005);
        ping.connect(pingAmp).connect(out);
        const source = this.noiseSource(time, 0.08);
        const tone = this.filter("bandpass", 3000, 1.4);
        const amp = this.gain();
        this.strike(amp.gain, time, vel * 0.55, 0.05, 0.001);
        source.connect(tone).connect(amp).connect(out);
        this.stopAll([ping], time, time + 0.05);
        break;
      }
      case "shaker": {
        const source = this.noiseSource(time, 0.1);
        const tone = this.filter("bandpass", 6500, 1.3);
        const amp = this.gain();
        this.strike(amp.gain, time, vel * 0.3, 0.055, 0.008);
        source.connect(tone).connect(amp).connect(out);
        break;
      }
      case "tom": {
        const body = this.osc("sine", 190);
        body.frequency.setValueAtTime(190, time);
        body.frequency.exponentialRampToValueAtTime(105, time + 0.18);
        const amp = this.gain();
        this.strike(amp.gain, time, vel * 0.8, 0.26);
        body.connect(amp).connect(out);
        this.stopAll([body], time, time + 0.32);
        break;
      }
    }
  }

  /** Kick pumping: the other buses duck and swell back, the breathing of pop. */
  pump(time: number): void {
    for (const [bus, depth] of Object.entries(PUMP_DEPTHS) as [Bus, number][]) {
      const gain = this.buses[bus].pump.gain;
      gain.cancelScheduledValues(time);
      gain.setTargetAtTime(1 - depth, time, 0.004);
      gain.setTargetAtTime(1, time + 0.03, 0.07);
    }
  }

  crash(time: number, vel = 0.5): void {
    const source = this.noiseSource(time, 1.8);
    const tone = this.filter("highpass", 4200);
    const shimmer = this.filter("peaking", 8000, 1.2);
    shimmer.gain.value = 6;
    const amp = this.gain();
    this.strike(amp.gain, time, vel * 0.42, 1.5, 0.002);
    source.connect(tone).connect(shimmer).connect(amp).connect(this.buses.fx.input);
  }

  // ---- chords -----------------------------------------------------------

  chord(sound: ChordSound, pitches: readonly number[], time: number, duration: number, vel: number): void {
    const out = this.buses.chords.input;
    const level = (vel * 0.9) / Math.sqrt(Math.max(1, pitches.length));
    const bright = this.bright;
    switch (sound) {
      case "pluck": {
        const tone = this.filter("lowpass", 900 * bright, 2);
        tone.frequency.setValueAtTime(5200 * bright, time);
        tone.frequency.setTargetAtTime(900 * bright, time + 0.005, 0.07);
        const amp = this.gain();
        this.strike(amp.gain, time, level * 2.4, Math.max(0.22, Math.min(duration, 0.5)), 0.003);
        const oscs = pitches.map((pitch) => {
          const osc = this.osc("sawtooth", midiToHz(pitch));
          osc.connect(tone);
          return osc;
        });
        tone.connect(amp).connect(out);
        this.stopAll(oscs, time, time + Math.max(0.25, Math.min(duration, 0.5)) + 0.05);
        break;
      }
      case "bell":
        for (const pitch of pitches) this.fmBell(pitch, time, level * 0.9, 1.1, 3.5, out);
        break;
      case "supersaw": {
        const pad = duration >= 0.6;
        const tone = this.filter("lowpass", (pad ? 2600 : 3800) * bright, 0.9);
        if (!pad) {
          tone.frequency.setValueAtTime(6500 * bright, time);
          tone.frequency.setTargetAtTime(2800 * bright, time + 0.01, 0.08);
        }
        const amp = this.gain();
        const end = pad
          ? this.hold(amp.gain, time, level * 0.7, duration, 0.06, 0.85, 0.3, 0.35)
          : this.hold(amp.gain, time, level * 1.2, duration, 0.004, 0.35, 0.18, 0.08);
        const oscs = pitches.flatMap((pitch) => [-14, 0, 14].map((cents) => {
          const osc = this.osc("sawtooth", midiToHz(pitch), cents);
          osc.connect(tone);
          return osc;
        }));
        tone.connect(amp).connect(out);
        this.stopAll(oscs, time, end);
        break;
      }
      case "epiano":
        for (const pitch of pitches) this.fmPiano(pitch, time, duration, level * 0.8, out);
        break;
      case "organ": {
        const tone = this.filter("lowpass", 4200 * bright);
        const amp = this.gain();
        const end = this.hold(amp.gain, time, level * 0.8, duration, 0.004, 0.75, 0.12, 0.06);
        const oscs = pitches.map((pitch) => {
          const osc = this.osc("organ", midiToHz(pitch));
          osc.connect(tone);
          return osc;
        });
        tone.connect(amp).connect(out);
        this.stopAll(oscs, time, end);
        break;
      }
      case "pad": {
        const tone = this.filter("lowpass", 1700 * bright, 0.6);
        const amp = this.gain();
        const end = this.hold(amp.gain, time, level * 0.75, duration, 0.28, 0.9, 0.5, 0.7);
        const oscs = pitches.flatMap((pitch) => [
          this.osc("sawtooth", midiToHz(pitch), -8),
          this.osc("sawtooth", midiToHz(pitch), 8),
          this.osc("triangle", midiToHz(pitch - 12)),
        ]);
        for (const osc of oscs) osc.connect(tone);
        tone.connect(amp).connect(out);
        this.stopAll(oscs, time, end);
        break;
      }
    }
  }

  private fmBell(pitch: number, time: number, level: number, decay: number, ratio: number, out: AudioNode): void {
    const frequency = midiToHz(pitch);
    const carrier = this.osc("sine", frequency);
    const modulator = this.osc("sine", frequency * ratio);
    const index = this.gain();
    index.gain.setValueAtTime(frequency * 2.2, time);
    index.gain.exponentialRampToValueAtTime(frequency * 0.08, time + decay * 0.6);
    modulator.connect(index).connect(carrier.frequency);
    const amp = this.gain();
    this.strike(amp.gain, time, level, decay, 0.002);
    carrier.connect(amp).connect(out);
    this.stopAll([carrier, modulator], time, time + decay + 0.05);
  }

  private fmPiano(pitch: number, time: number, duration: number, level: number, out: AudioNode): void {
    const frequency = midiToHz(pitch);
    const carrier = this.osc("sine", frequency);
    const modulator = this.osc("sine", frequency);
    const index = this.gain();
    index.gain.setValueAtTime(frequency * 1.8 * this.bright, time);
    index.gain.setTargetAtTime(frequency * 0.25, time, 0.12);
    modulator.connect(index).connect(carrier.frequency);
    const tine = this.osc("sine", frequency * 4);
    const tineAmp = this.gain();
    this.strike(tineAmp.gain, time, level * 0.12, 0.08);
    tine.connect(tineAmp).connect(out);
    const amp = this.gain();
    const end = this.hold(amp.gain, time, level, duration, 0.003, 0.45, 0.8, 0.25);
    carrier.connect(amp).connect(out);
    this.stopAll([carrier, modulator, tine], time, end);
  }

  // ---- hook -------------------------------------------------------------

  hook(sound: HookSound, pitch: number, time: number, duration: number, vel: number): void {
    const out = this.buses.hook.input;
    const frequency = midiToHz(pitch);
    const level = vel * 0.55;
    const bright = this.bright;
    switch (sound) {
      case "chip": {
        const osc = this.osc("pulse", frequency);
        this.vibrato(osc, time, duration, 14);
        const tone = this.filter("lowpass", 6500 * bright);
        const amp = this.gain();
        const end = this.hold(amp.gain, time, level * 1.45, duration * 0.92, 0.003, 0.72, 0.1, 0.05);
        osc.connect(tone).connect(amp).connect(out);
        this.stopAll([osc], time, end);
        break;
      }
      case "bell":
        this.fmBell(pitch, time, level * 1.05, 0.9, 3.5, out);
        break;
      case "saw": {
        const tone = this.filter("lowpass", 4200 * bright, 1.2);
        tone.frequency.setValueAtTime(7000 * bright, time);
        tone.frequency.setTargetAtTime(3600 * bright, time + 0.01, 0.1);
        const amp = this.gain();
        const end = this.hold(amp.gain, time, level * 0.55, duration * 0.95, 0.004, 0.8, 0.12, 0.09);
        const oscs = [-10, 0, 10].map((cents) => this.osc("sawtooth", frequency, cents));
        for (const osc of oscs) osc.connect(tone);
        tone.connect(amp).connect(out);
        this.stopAll(oscs, time, end);
        break;
      }
      case "flute": {
        const osc = this.osc("triangle", frequency);
        this.vibrato(osc, time, duration, 18, 0.22);
        const air = this.osc("sine", frequency * 2);
        const airAmp = this.gain(0.12);
        air.connect(airAmp);
        const tone = this.filter("lowpass", 3200 * bright);
        const amp = this.gain();
        const end = this.hold(amp.gain, time, level * 0.65, duration * 0.95, 0.035, 0.85, 0.2, 0.12);
        osc.connect(tone);
        airAmp.connect(tone);
        tone.connect(amp).connect(out);
        const breath = this.noiseSource(time, 0.12);
        const breathTone = this.filter("bandpass", 2400, 1.5);
        const breathAmp = this.gain();
        this.strike(breathAmp.gain, time, level * 0.12, 0.08, 0.01);
        breath.connect(breathTone).connect(breathAmp).connect(out);
        this.stopAll([osc, air], time, end);
        break;
      }
      case "pluck": {
        const osc = this.osc("sawtooth", frequency);
        const tone = this.filter("lowpass", 1200 * bright, 3);
        tone.frequency.setValueAtTime(6000 * bright, time);
        tone.frequency.setTargetAtTime(1000 * bright, time + 0.004, 0.06);
        const amp = this.gain();
        this.strike(amp.gain, time, level * 2.9, Math.max(0.2, Math.min(duration, 0.45)), 0.002);
        osc.connect(tone).connect(amp).connect(out);
        this.stopAll([osc], time, time + 0.5);
        break;
      }
    }
    // Sugar above half adds a bell an octave up: sweeter, more toy-like.
    const double = clamp01((this.knobs.sugar - 0.5) * 2);
    if (double > 0.02 && sound !== "bell") this.fmBell(pitch + 12, time, level * 0.3 * double, 0.5, 4, this.buses.sparkle.input);
  }

  private vibrato(osc: OscillatorNode, time: number, duration: number, cents: number, delay = 0.16): void {
    if (duration < delay + 0.05) return;
    const lfo = this.osc("sine", 5.6);
    const depth = this.gain();
    depth.gain.setValueAtTime(0, time);
    depth.gain.linearRampToValueAtTime(0, time + delay);
    depth.gain.linearRampToValueAtTime(cents, time + delay + 0.15);
    lfo.connect(depth).connect(osc.detune);
    this.stopAll([lfo], time, time + duration + 0.2);
  }

  // ---- bass -------------------------------------------------------------

  bass(sound: BassSound, pitch: number, time: number, duration: number, vel: number, glide: boolean): void {
    const out = this.buses.bass.input;
    const frequency = midiToHz(pitch);
    const level = vel * 0.8;
    const from = glide && this.lastBassPitch !== null ? midiToHz(this.lastBassPitch) : null;
    this.lastBassPitch = pitch;
    switch (sound) {
      case "square": {
        const osc = this.osc("square", frequency);
        const tone = this.filter("lowpass", 1300, 1.5);
        tone.frequency.setValueAtTime(2400, time);
        tone.frequency.setTargetAtTime(900, time + 0.005, 0.06);
        const amp = this.gain();
        const end = this.hold(amp.gain, time, level * 0.42, duration * 0.9, 0.003, 0.75, 0.1, 0.04);
        osc.connect(tone).connect(amp).connect(out);
        this.stopAll([osc], time, end);
        break;
      }
      case "sub": {
        const osc = this.osc("sub", frequency);
        const amp = this.gain();
        const end = this.hold(amp.gain, time, level * 0.95, duration * 0.95, 0.008, 0.9, 0.2, 0.08);
        osc.connect(amp).connect(out);
        this.stopAll([osc], time, end);
        break;
      }
      case "808": {
        const osc = this.osc("sine", frequency);
        if (from) {
          osc.frequency.setValueAtTime(from, time);
          osc.frequency.exponentialRampToValueAtTime(frequency, time + 0.07);
        } else {
          osc.frequency.setValueAtTime(frequency * 1.9, time);
          osc.frequency.exponentialRampToValueAtTime(frequency, time + 0.035);
        }
        const amp = this.gain();
        const end = this.hold(amp.gain, time, level * 1.05, Math.max(duration, 0.18), 0.002, 0.8, 0.6, 0.12);
        osc.connect(amp).connect(out);
        this.stopAll([osc], time, end);
        break;
      }
      case "saw": {
        const osc = this.osc("sawtooth", frequency);
        const tone = this.filter("lowpass", 500, 4);
        tone.frequency.setValueAtTime(2300, time);
        tone.frequency.setTargetAtTime(480, time + 0.004, 0.05);
        const amp = this.gain();
        const end = this.hold(amp.gain, time, level * 1.2, duration * 0.85, 0.002, 0.6, 0.1, 0.035);
        osc.connect(tone).connect(amp).connect(out);
        this.stopAll([osc], time, end);
        break;
      }
    }
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
    const amp = this.gain(voice.level);
    const panner = this.context.createStereoPanner();
    panner.pan.value = voice.pan;
    source.connect(amp).connect(panner).connect(this.buses.voice.input);
    source.start(time + voice.delay, Math.max(0, Math.min(buffer.duration - 0.001, offset)));
    return source;
  }

  /** The machine grumbling after another pull without a jackpot. */
  grumble(time: number): void {
    [[330, 0], [247, 0.12]].forEach(([frequency, offset]) => {
      const blip = this.osc("square", frequency!);
      const tone = this.filter("lowpass", 1400);
      const amp = this.gain();
      this.strike(amp.gain, time + offset!, 0.07, 0.12, 0.004);
      blip.frequency.setValueAtTime(frequency!, time + offset!);
      blip.frequency.exponentialRampToValueAtTime(frequency! * 0.85, time + offset! + 0.12);
      blip.connect(tone).connect(amp).connect(this.buses.fx.input);
      this.stopAll([blip], time + offset!, time + offset! + 0.18);
    });
  }

  /** A coin dropping into the slot: the voice is in. */
  coin(time: number): void {
    [0, 0.07, 0.15].forEach((offset, index) => {
      const ding = this.osc("triangle", [2349, 3136, 2637][index]!);
      const amp = this.gain();
      this.strike(amp.gain, time + offset, 0.16, 0.2, 0.001);
      ding.connect(amp).connect(this.buses.fx.input);
      this.stopAll([ding], time + offset, time + offset + 0.25);
    });
    this.clack(time + 0.24);
  }

  // ---- glitter ----------------------------------------------------------

  sparkle(pitch: number, time: number, vel: number): void {
    this.fmBell(pitch, time, vel * 0.3, 0.32, 4, this.buses.sparkle.input);
  }

  // ---- the machine itself -----------------------------------------------

  /** One click of the lever's ratchet; higher as the lever goes down. */
  ratchet(time: number, depth: number): void {
    const click = this.noiseSource(time, 0.02);
    const tone = this.filter("highpass", 2400);
    const amp = this.gain();
    this.strike(amp.gain, time, 0.22, 0.012, 0.0005);
    click.connect(tone).connect(amp).connect(this.buses.fx.input);
    const blip = this.osc("square", 700 + depth * 1100);
    const blipAmp = this.gain();
    this.strike(blipAmp.gain, time, 0.05, 0.02, 0.0005);
    blip.connect(blipAmp).connect(this.buses.fx.input);
    this.stopAll([blip], time, time + 0.04);
  }

  /** A reel slamming into place. */
  clack(time: number): void {
    const thump = this.osc("sine", 150);
    thump.frequency.setValueAtTime(150, time);
    thump.frequency.exponentialRampToValueAtTime(80, time + 0.04);
    const thumpAmp = this.gain();
    this.strike(thumpAmp.gain, time, 0.35, 0.05, 0.001);
    thump.connect(thumpAmp).connect(this.buses.fx.input);
    const knock = this.noiseSource(time, 0.05);
    const tone = this.filter("bandpass", 1900, 2);
    const amp = this.gain();
    this.strike(amp.gain, time, 0.5, 0.03, 0.0005);
    knock.connect(tone).connect(amp).connect(this.buses.fx.input);
    this.stopAll([thump], time, time + 0.08);
  }

  /** The reels rattling past while they spin. */
  tick(time: number, level = 0.1): void {
    const click = this.noiseSource(time, 0.01);
    const tone = this.filter("highpass", 4200);
    const amp = this.gain();
    this.strike(amp.gain, time, level, 0.006, 0.0005);
    click.connect(tone).connect(amp).connect(this.buses.fx.input);
  }

  /** A hold button locking in. */
  clunk(time: number): void {
    const body = this.osc("sine", 95);
    const amp = this.gain();
    this.strike(amp.gain, time, 0.4, 0.07, 0.001);
    body.connect(amp).connect(this.buses.fx.input);
    this.tick(time, 0.2);
    this.stopAll([body], time, time + 0.1);
  }

  /** The spin: rising noise and a sweeping saw, ending exactly on the drop. */
  riser(start: number, end: number): void {
    const length = Math.max(0.1, end - start);
    const source = this.noiseSource(start, length);
    const tone = this.filter("bandpass", 300, 3);
    tone.frequency.setValueAtTime(300, start);
    tone.frequency.exponentialRampToValueAtTime(7500, end);
    const amp = this.gain();
    amp.gain.setValueAtTime(0.0001, start);
    amp.gain.exponentialRampToValueAtTime(0.32, end - 0.01);
    amp.gain.linearRampToValueAtTime(0, end);
    source.connect(tone).connect(amp).connect(this.buses.fx.input);
    const sweep = this.osc("sawtooth", 110);
    sweep.frequency.setValueAtTime(110, start);
    sweep.frequency.exponentialRampToValueAtTime(880, end);
    const sweepTone = this.filter("lowpass", 2000);
    const sweepAmp = this.gain();
    sweepAmp.gain.setValueAtTime(0.0001, start);
    sweepAmp.gain.exponentialRampToValueAtTime(0.06, end - 0.01);
    sweepAmp.gain.linearRampToValueAtTime(0, end);
    sweep.connect(sweepTone).connect(sweepAmp).connect(this.buses.fx.input);
    this.stopAll([sweep], start, end + 0.02);
  }

  /** The jackpot: a bell run up through the chord and a shower of coin dings. */
  jingle(time: number, voicing: readonly number[], stepDuration: number): void {
    const up = [...voicing].sort((a, b) => a - b).map((pitch) => pitch + 12);
    const run = [...up, ...up.map((pitch) => pitch + 12)];
    run.forEach((pitch, index) => this.fmBell(pitch, time + index * stepDuration * 0.5, 0.28, 0.6, 3.5, this.buses.fx.input));
    const coins = time + run.length * stepDuration * 0.5;
    for (let index = 0; index < 6; index += 1) {
      const at = coins + index * stepDuration * 0.5;
      const ding = this.osc("triangle", index % 2 === 0 ? 1976 : 2637);
      const amp = this.gain();
      this.strike(amp.gain, at, 0.12, 0.18, 0.001);
      ding.connect(amp).connect(this.buses.fx.input);
      this.stopAll([ding], at, at + 0.22);
    }
    this.crash(time, 0.7);
  }
}
