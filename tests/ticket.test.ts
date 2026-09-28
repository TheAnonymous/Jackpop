import { describe, expect, it } from "vitest";
import { oggCrc, oggOpusFile, opusHead, opusTags } from "../src/ticket/ogg";
import { encodeRecipe, readRecipe, recipeLink } from "../src/ticket/recipe";
import { fileSlug, songTitle } from "../src/ticket/title";
import { createProject } from "../src/store";

interface Page { flags: number; granule: bigint; sequence: number; packets: Uint8Array[]; crcOk: boolean; continues: boolean }

/** A small Ogg reader for the tests: pages, their packets and whether each CRC is right. */
function readOgg(file: Uint8Array): Page[] {
  const pages: Page[] = [];
  let offset = 0;
  while (offset < file.length) {
    const view = new DataView(file.buffer, file.byteOffset + offset);
    expect(new TextDecoder().decode(file.subarray(offset, offset + 4))).toBe("OggS");
    const segments = file[offset + 26]!;
    const lacing = Array.from(file.subarray(offset + 27, offset + 27 + segments));
    const length = 27 + segments + lacing.reduce((sum, value) => sum + value, 0);
    const bytes = file.slice(offset, offset + length);
    const stored = view.getUint32(22, true);
    new DataView(bytes.buffer).setUint32(22, 0, true);
    const packets: Uint8Array[] = [];
    let start = 27 + segments;
    let size = 0;
    let continues = false;
    for (const value of lacing) {
      size += value;
      if (value < 255) {
        packets.push(file.subarray(offset + start, offset + start + size));
        start += size;
        size = 0;
      }
      continues = value === 255;
    }
    pages.push({ flags: file[offset + 5]!, granule: view.getBigInt64(6, true), sequence: view.getUint32(18, true), packets, crcOk: oggCrc(bytes) === stored, continues });
    offset += length;
  }
  return pages;
}

describe("Ogg Opus", () => {
  it("uses Ogg's CRC-32", () => {
    expect(oggCrc(new TextEncoder().encode("123456789"))).toBe(0x89a1897f);
  });

  it("writes head and tags pages, then audio pages that hold every packet with correct CRCs and granules", () => {
    const head = opusHead(2, 312, 48_000);
    const tags = opusTags("Jackpop", ["TITLE=Mondschein-Party"]);
    const sizes = [1, 120, 254, 255, 256, 510, 300, ...Array.from({ length: 300 }, (_, index) => 90 + (index % 200))];
    const packets = sizes.map((size, index) => ({ data: new Uint8Array(size).fill(index % 251), granule: BigInt(312 + (index + 1) * 960) }));
    const pages = readOgg(oggOpusFile(head, tags, packets));
    expect(pages.every((page) => page.crcOk)).toBe(true);
    expect(pages.map((page) => page.sequence)).toEqual(pages.map((_, index) => index));
    expect(pages[0]!.flags).toBe(0x02);
    expect(new TextDecoder().decode(pages[0]!.packets[0]!.subarray(0, 8))).toBe("OpusHead");
    expect(new TextDecoder().decode(pages[1]!.packets[0]!.subarray(0, 8))).toBe("OpusTags");
    expect(pages[pages.length - 1]!.flags).toBe(0x04);
    const audio = pages.slice(2);
    expect(audio.flatMap((page) => page.packets).map((packet) => packet.length)).toEqual(sizes);
    for (let index = 1; index < audio.length; index += 1) expect(audio[index]!.granule).toBeGreaterThan(audio[index - 1]!.granule);
    expect(audio[audio.length - 1]!.granule).toBe(packets[packets.length - 1]!.granule);
    expect(audio.every((page) => !page.continues)).toBe(true);
  });

  it("describes channels, pre-skip and rate in the OpusHead", () => {
    const head = opusHead(2, 312, 48_000);
    const view = new DataView(head.buffer);
    expect(head[8]).toBe(1);
    expect(head[9]).toBe(2);
    expect(view.getUint16(10, true)).toBe(312);
    expect(view.getUint32(12, true)).toBe(48_000);
  });
});

describe("song titles", () => {
  it("names the song after hook and beat", () => {
    expect(songTitle("dreamy", "club")).toBe("Mondschein-Party");
    expect(songTitle("rare", "sweet")).toBe("Diamanten-Hüpfer");
    expect(fileSlug("Mondschein-Träumerei")).toBe("mondschein-traeumerei");
    expect(fileSlug("!!!")).toBe("song");
  });
});

describe("recipe links", () => {
  it("carries the line, sounds, knobs, tempo and mode, but not the voice", () => {
    const project = createProject();
    project.tempo = 163;
    project.mode = "song";
    project.knobs = { sugar: 0.9, glitter: 0.1, chaos: 0.66 };
    project.reels.hook = { position: 7, held: true, sound: "flute", shift: 1 };
    project.reels.beat = { position: 12, held: false, sound: null, shift: -1 };
    project.voice = { id: "take-mine", startStep: 3, tempo: 150, muted: false };
    const link = recipeLink("https://musik.jodie-oesterling.de/Jackpop/", project);
    expect(link).toMatch(/^https:\/\/musik\.jodie-oesterling\.de\/Jackpop\/#rezept=[A-Za-z0-9_-]+$/);
    expect(link).not.toContain("take-mine");

    const recipe = readRecipe(new URL(link).hash)!;
    expect(recipe.diamonds).toEqual(["beat"]);
    const friend = createProject();
    friend.voice = { id: "take-friend", startStep: 0, tempo: 120, muted: false };
    friend.volume = 0.4;
    const result = recipe.apply(friend);
    expect(result.tempo).toBe(163);
    expect(result.mode).toBe("song");
    expect(result.knobs).toEqual({ sugar: 0.9, glitter: 0.1, chaos: 0.66 });
    expect(result.reels.hook).toEqual({ position: 7, held: false, sound: "flute", shift: 1 });
    expect(result.reels.beat.position).toBe(12);
    expect(result.voice?.id).toBe("take-friend");
    expect(result.volume).toBe(0.4);
  });

  it("ignores missing or broken recipes", () => {
    expect(readRecipe("")).toBeNull();
    expect(readRecipe("#other=1")).toBeNull();
    expect(readRecipe("#rezept=%%%%")).toBeNull();
    expect(readRecipe(`#rezept=${btoa(JSON.stringify({ v: 2, r: [] }))}`)).toBeNull();
    expect(encodeRecipe(createProject()).length).toBeLessThan(200);
  });
});
