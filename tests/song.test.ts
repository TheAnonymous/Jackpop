import { describe, expect, it } from "vitest";
import { BONUS, LOOP_SECTION, SONG, SONG_BARS, SONG_DROP, songSeconds } from "../src/music/song";

describe("song form", () => {
  it("runs intro, verse, chorus, drop, lifted chorus and outro in whole loops", () => {
    expect(SONG.map((part) => part.name)).toEqual(["intro", "verse", "chorus", "drop", "lift", "outro"]);
    for (const part of [...SONG, ...BONUS, LOOP_SECTION]) expect(part.bars % 4, part.name).toBe(0);
    expect(SONG_BARS).toBe(36);
    expect(songSeconds(150)).toBeCloseTo(57.6, 5);
    expect(SONG[SONG_DROP]!.name).toBe("drop");
  });

  it("lifts the last chorus a whole tone and lets the voice sing only in choruses", () => {
    expect(SONG.find((part) => part.name === "lift")!.transpose).toBe(2);
    expect(SONG.filter((part) => part.voice).map((part) => part.name)).toEqual(["chorus", "lift"]);
    expect(SONG.find((part) => part.name === "drop")!.chop).toBe(true);
  });

  it("rewards a jackpot in loop mode with a bonus drop and a lifted round", () => {
    expect(BONUS.map((part) => part.label)).toEqual(["Bonus-Drop", "Rückung"]);
    expect(BONUS[1]!.transpose).toBe(2);
  });
});
