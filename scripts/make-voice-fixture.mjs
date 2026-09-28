// Writes e2e/fixtures/voice.wav: a sung "aah" at about 220 Hz with vibrato,
// which Chrome plays as a fake microphone in the E2E tests.
import { writeFileSync } from "node:fs";

const rate = 16_000;
const seconds = 4;
const samples = new Int16Array(rate * seconds);
let phase = 0;
for (let index = 0; index < samples.length; index += 1) {
  const time = index / rate;
  const hz = 220 * 2 ** ((25 * Math.sin(2 * Math.PI * 5.5 * time)) / 1200);
  phase += (2 * Math.PI * hz) / rate;
  // Harmonics shaped roughly like an open vowel, fading in and out every syllable.
  const vowel = [1, 0.8, 0.65, 0.5, 0.25, 0.15, 0.1].reduce((sum, amplitude, harmonic) => sum + amplitude * Math.sin((harmonic + 1) * phase), 0);
  const syllable = Math.min(1, (time % 0.8) / 0.03, (0.7 - (time % 0.8)) / 0.05);
  samples[index] = Math.round(Math.max(0, syllable) * vowel * 0.22 * 32_767);
}
const header = Buffer.alloc(44);
header.write("RIFF", 0);
header.writeUInt32LE(36 + samples.byteLength, 4);
header.write("WAVEfmt ", 8);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20);
header.writeUInt16LE(1, 22);
header.writeUInt32LE(rate, 24);
header.writeUInt32LE(rate * 2, 28);
header.writeUInt16LE(2, 32);
header.writeUInt16LE(16, 34);
header.write("data", 36);
header.writeUInt32LE(samples.byteLength, 40);
writeFileSync(new URL("../e2e/fixtures/voice.wav", import.meta.url), Buffer.concat([header, Buffer.from(samples.buffer)]));
