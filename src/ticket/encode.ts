import { oggOpusFile, opusHead, opusTags, type OggPacket } from "./ogg";

export interface EncodedSong {
  blob: Blob;
  extension: "ogg" | "wav";
  type: string;
}

const OPUS_RATE = 48_000;
const OPUS_BITRATE = 128_000;
/** libopus' look-ahead at 48 kHz, used when the encoder does not say. */
const DEFAULT_PRE_SKIP = 312;

async function opusSupported(channels: number): Promise<boolean> {
  if (typeof AudioEncoder === "undefined" || typeof AudioData === "undefined") return false;
  try {
    const support = await AudioEncoder.isConfigSupported({ codec: "opus", sampleRate: OPUS_RATE, numberOfChannels: channels, bitrate: OPUS_BITRATE });
    return support.supported === true;
  } catch {
    return false;
  }
}

function preSkipOf(description: Uint8Array | null): number {
  if (!description || description.length < 12) return DEFAULT_PRE_SKIP;
  const magic = new TextDecoder().decode(description.subarray(0, 8));
  return magic === "OpusHead" ? new DataView(description.buffer, description.byteOffset).getUint16(10, true) : DEFAULT_PRE_SKIP;
}

/** Ogg Opus through the browser's AudioEncoder; `null` where it cannot (then WAV is used). */
export async function encodeOpus(buffer: AudioBuffer, title: string): Promise<Blob | null> {
  const channels = buffer.numberOfChannels;
  if (buffer.sampleRate !== OPUS_RATE || !(await opusSupported(channels))) return null;
  const packets: { data: Uint8Array; samples: number }[] = [];
  let description: Uint8Array | null = null;
  let failure: unknown = null;
  const encoder = new AudioEncoder({
    output: (chunk, metadata) => {
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      packets.push({ data, samples: Math.round(((chunk.duration ?? 20_000) * OPUS_RATE) / 1_000_000) });
      const config = metadata?.decoderConfig?.description;
      if (config && !description) description = ArrayBuffer.isView(config) ? new Uint8Array(config.buffer, config.byteOffset, config.byteLength) : new Uint8Array(config);
    },
    error: (error) => { failure = error; },
  });
  encoder.configure({ codec: "opus", sampleRate: OPUS_RATE, numberOfChannels: channels, bitrate: OPUS_BITRATE });
  const block = OPUS_RATE;
  for (let start = 0; start < buffer.length; start += block) {
    const frames = Math.min(block, buffer.length - start);
    const data = new Float32Array(frames * channels);
    for (let channel = 0; channel < channels; channel += 1) data.set(buffer.getChannelData(channel).subarray(start, start + frames), channel * frames);
    const audio = new AudioData({ format: "f32-planar", sampleRate: OPUS_RATE, numberOfFrames: frames, numberOfChannels: channels, timestamp: Math.round((start / OPUS_RATE) * 1_000_000), data });
    encoder.encode(audio);
    audio.close();
  }
  await encoder.flush();
  encoder.close();
  if (failure || packets.length === 0) return null;
  const preSkip = preSkipOf(description);
  const end = BigInt(preSkip + buffer.length);
  let decoded = 0n;
  const pages: OggPacket[] = packets.map((packet) => {
    decoded += BigInt(packet.samples);
    return { data: packet.data, granule: decoded < end ? decoded : end };
  });
  const file = oggOpusFile(opusHead(channels, preSkip, OPUS_RATE), opusTags("Jackpop", [`TITLE=${title}`, "ARTIST=Jackpop"]), pages);
  return new Blob([file.buffer as ArrayBuffer], { type: "audio/ogg" });
}

/** 16-bit PCM WAV: bigger, but plays everywhere. */
export function encodeWav(buffer: AudioBuffer): Blob {
  const channels = buffer.numberOfChannels;
  const frames = buffer.length;
  const bytes = new ArrayBuffer(44 + frames * channels * 2);
  const view = new DataView(bytes);
  const text = (offset: number, value: string) => { for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index)); };
  text(0, "RIFF");
  view.setUint32(4, 36 + frames * channels * 2, true);
  text(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, frames * channels * 2, true);
  const data = Array.from({ length: channels }, (_, channel) => buffer.getChannelData(channel));
  let offset = 44;
  for (let frame = 0; frame < frames; frame += 1) {
    for (const channel of data) {
      const sample = Math.max(-1, Math.min(1, channel[frame]!));
      view.setInt16(offset, Math.round(sample * 32_767), true);
      offset += 2;
    }
  }
  return new Blob([bytes], { type: "audio/wav" });
}

export async function encodeSong(buffer: AudioBuffer, title: string): Promise<EncodedSong> {
  const opus = await encodeOpus(buffer, title).catch(() => null);
  if (opus) return { blob: opus, extension: "ogg", type: "audio/ogg" };
  return { blob: encodeWav(buffer), extension: "wav", type: "audio/wav" };
}
