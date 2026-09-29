import { microphoneSession } from "../audio/ios-audio";
import processorUrl from "./mic-processor.js?url&no-inline";

export interface Take {
  samples: Float32Array;
  sampleRate: number;
  /** Audio-clock time of the first sample, as it arrived. */
  startTime: number;
  /** What the microphone path reports as its own delay, in seconds. */
  inputLatency: number;
}

const PROCESSOR = "jackpop-coin-slot";
/** The microphone stays open this long after a take, so the next one starts at once. */
const KEEP_OPEN_MS = 60_000;

/**
 * The coin slot's microphone: opened on the first press (the browser asks for
 * permission then), recorded through an AudioWorklet on the music's own audio
 * clock, so a take can be placed exactly in the loop.
 */
export class Microphone {
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private node: AudioWorkletNode | null = null;
  private analyser: AnalyserNode | null = null;
  private sink: GainNode | null = null;
  private context: AudioContext | null = null;
  private moduleLoaded = new WeakSet<AudioContext>();
  private chunks: Float32Array[] = [];
  private startTime = 0;
  private finish: ((take: Take) => void) | null = null;
  private closeTimer: ReturnType<typeof setTimeout> | null = null;
  private meterData = new Float32Array(512);

  get open(): boolean {
    return this.stream !== null;
  }

  static supported(): boolean {
    return typeof navigator.mediaDevices?.getUserMedia === "function" && typeof AudioWorkletNode === "function";
  }

  async openOn(context: AudioContext): Promise<void> {
    this.keepOpen();
    if (this.stream && this.context === context) return;
    this.close();
    microphoneSession(true);
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });
    if (!this.moduleLoaded.has(context)) {
      await context.audioWorklet.addModule(processorUrl);
      this.moduleLoaded.add(context);
    }
    const source = context.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(context, PROCESSOR, { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], channelCount: 1, channelCountMode: "explicit" });
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    // A worklet only runs while something pulls it; a muted path to the output does.
    const sink = context.createGain();
    sink.gain.value = 0;
    source.connect(node);
    source.connect(analyser);
    node.connect(sink);
    sink.connect(context.destination);
    node.port.onmessage = (event: MessageEvent<{ samples?: Float32Array; start?: number; done?: boolean }>) => this.receive(event.data);
    Object.assign(this, { stream, source, node, analyser, sink, context });
  }

  start(): void {
    this.chunks = [];
    this.startTime = this.context?.currentTime ?? 0;
    this.node?.port.postMessage("start");
  }

  stop(): Promise<Take> {
    this.keepOpen();
    const node = this.node;
    if (!node) return Promise.resolve(this.take());
    return new Promise((resolve) => {
      this.finish = resolve;
      node.port.postMessage("stop");
    });
  }

  /** How loud the microphone is right now, 0–1, for the slot's meter. */
  level(): number {
    if (!this.analyser) return 0;
    this.analyser.getFloatTimeDomainData(this.meterData);
    let sum = 0;
    for (const value of this.meterData) sum += value * value;
    return Math.min(1, Math.sqrt(sum / this.meterData.length) * 6);
  }

  close(): void {
    if (this.closeTimer) clearTimeout(this.closeTimer);
    this.closeTimer = null;
    if (this.stream) microphoneSession(false);
    this.stream?.getTracks().forEach((track) => track.stop());
    this.source?.disconnect();
    this.node?.disconnect();
    this.sink?.disconnect();
    this.stream = null;
    this.source = null;
    this.node = null;
    this.analyser = null;
    this.sink = null;
  }

  private keepOpen(): void {
    if (this.closeTimer) clearTimeout(this.closeTimer);
    this.closeTimer = setTimeout(() => this.close(), KEEP_OPEN_MS);
  }

  private receive(data: { samples?: Float32Array; start?: number; done?: boolean }): void {
    if (data.start !== undefined) this.startTime = data.start;
    if (data.samples) this.chunks.push(data.samples);
    if (data.done && this.finish) {
      const finish = this.finish;
      this.finish = null;
      finish(this.take());
    }
  }

  private take(): Take {
    const length = this.chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const samples = new Float32Array(length);
    let offset = 0;
    for (const chunk of this.chunks) {
      samples.set(chunk, offset);
      offset += chunk.length;
    }
    this.chunks = [];
    const settings = this.stream?.getAudioTracks()[0]?.getSettings() as (MediaTrackSettings & { latency?: number }) | undefined;
    return { samples, sampleRate: this.context?.sampleRate ?? 48_000, startTime: this.startTime, inputLatency: settings?.latency ?? 0.02 };
  }
}
