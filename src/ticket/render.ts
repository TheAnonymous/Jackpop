import type { EngineSettings } from "../audio/engine";
import { PopEngine } from "../audio/engine";
import { renderInChunks } from "../audio/offline";
import type { LoopData } from "../music/loop";
import { songSeconds } from "../music/song";

export interface TunedVoice {
  base: Float32Array;
  lifted: Float32Array;
  sampleRate: number;
}

/** The ticket's sample rate: Opus runs at 48 kHz. */
export const TICKET_RATE = 48_000;
/** A little room after the outro for the last reverb to ring out. */
const TAIL_SECONDS = 2.5;

export function ticketSeconds(tempo: number): number {
  return songSeconds(tempo) + TAIL_SECONDS;
}

/** Renders the line as a whole song, with the voice, the way the ticket carries it. */
export async function renderSong(loop: LoopData, settings: EngineSettings, voice: TunedVoice | null, onProgress: (share: number) => void = () => undefined): Promise<AudioBuffer> {
  const seconds = ticketSeconds(settings.tempo);
  const context = new OfflineAudioContext(2, Math.ceil(seconds * TICKET_RATE), TICKET_RATE);
  const engine = new PopEngine(loop, settings, { context });
  await engine.unlock();
  engine.setMode("song");
  if (voice) {
    const buffer = (samples: Float32Array) => {
      const target = context.createBuffer(1, samples.length, voice.sampleRate);
      target.getChannelData(0).set(samples);
      return target;
    };
    engine.setVoice(buffer(voice.base), buffer(voice.lifted));
  }
  return renderInChunks(context, (until) => engine.renderUntil(until), seconds, 2, onProgress);
}
