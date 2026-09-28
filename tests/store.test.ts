import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { detectJackpot } from "../src/machine/machine";
import { STRIPS, variantAt } from "../src/music/reels";
import { createProject, JackpopStore, sanitizeProject, type Storage } from "../src/store";

class MemoryStorage implements Storage {
  readonly items = new Map<string, string>();
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }
}

let storage: MemoryStorage;
beforeEach(() => {
  storage = new MemoryStorage();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("JackpopStore", () => {
  it("greets you one symbol short of a jackpot", () => {
    const project = createProject();
    const families = (["beat", "chords", "hook", "bass"] as const).map((reel) => variantAt(reel, project.reels[reel].position).family);
    expect(families).toEqual(["club", "sweet", "sweet", "sweet"]);
    expect(detectJackpot({ beat: project.reels.beat.position, chords: 0, hook: 0, bass: 0 })?.count).toBe(3);
  });

  it("holds, nudges around the strip and forgets a symbol's tweaks when it changes", () => {
    const store = new JackpopStore(storage);
    store.toggleHold("beat");
    expect(store.project.value.reels.beat.held).toBe(true);
    store.setSound("hook", "flute");
    store.setShift("hook", 1);
    store.nudge("hook", -1);
    expect(store.project.value.reels.hook).toMatchObject({ position: STRIPS.hook.length - 1, sound: null, shift: 0 });
    store.nudge("hook", 1);
    expect(store.project.value.reels.hook.position).toBe(0);
  });

  it("lands a spin and keeps tweaks on reels that did not move", () => {
    const store = new JackpopStore(storage);
    store.setSound("bass", "808");
    store.setSound("chords", "organ");
    store.applySpin({ beat: 5, chords: 7, hook: 0, bass: 0 });
    const reels = store.project.value.reels;
    expect(reels.beat.position).toBe(5);
    expect(reels.chords).toMatchObject({ position: 7, sound: null });
    expect(reels.bass.sound).toBe("808");
  });

  it("undoes a pull, so the loop you had is never lost", () => {
    const store = new JackpopStore(storage);
    const before = structuredClone(store.project.value);
    store.applySpin({ beat: 1, chords: 2, hook: 3, bass: 4 });
    store.undo();
    expect(store.project.value).toEqual(before);
    store.redo();
    expect(store.project.value.reels.hook.position).toBe(3);
  });

  it("makes one undo step of a knob turn", () => {
    vi.useFakeTimers();
    const store = new JackpopStore(storage);
    for (const value of [0.6, 0.7, 0.8]) {
      store.setKnob("chaos", value);
      vi.advanceTimersByTime(100);
    }
    store.undo();
    expect(store.project.value.knobs.chaos).toBe(createProject().knobs.chaos);
  });

  it("counts pulls and jackpots outside the undo history", () => {
    const store = new JackpopStore(storage);
    store.recordPull(null);
    store.recordPull({ family: "wild", count: 3, reels: ["beat", "chords", "hook"] });
    store.recordPull({ family: "sweet", count: 4, reels: ["beat", "chords", "hook", "bass"] });
    store.undo();
    expect(store.stats.value).toEqual({ pulls: 3, jackpots: 2, best: { family: "sweet", count: 4 } });
    expect(new JackpopStore(storage).stats.value.pulls).toBe(3);
  });

  it("saves every change and falls back to the previous save when the last is damaged", () => {
    const store = new JackpopStore(storage);
    store.setTempo(140);
    store.setTempo(160);
    expect(new JackpopStore(storage).project.value.tempo).toBe(160);
    storage.setItem("jackpop.project.v1", "{broken");
    const restored = new JackpopStore(storage);
    expect(restored.project.value.tempo).toBe(140);
    expect(restored.restoredFromBackup).toBe(true);
  });

  it("keeps working when storage fails", () => {
    const failing: Storage = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("full"); } };
    const store = new JackpopStore(failing);
    store.setTempo(120);
    store.recordPull(null);
    expect(store.project.value.tempo).toBe(120);
  });
});

describe("sanitizeProject", () => {
  it("turns anything into a playable machine", () => {
    for (const value of [null, 7, "x", { reels: "no" }]) expect(sanitizeProject(value).reels.beat.position).toBe(createProject().reels.beat.position);
    const project = sanitizeProject({ tempo: 999, key: "H", knobs: { sugar: 3, chaos: "wild" }, reels: { hook: { position: 25, held: "yes", sound: "kazoo", shift: 5 } } });
    expect(project.tempo).toBe(180);
    expect(project.key).toBe("C");
    expect(project.knobs.sugar).toBe(1);
    expect(project.knobs.chaos).toBe(createProject().knobs.chaos);
    expect(project.reels.hook).toEqual({ position: 1, held: false, sound: null, shift: 1 });
  });
});

describe("the voice", () => {
  it("is replaced by a new take, muted and removed, and undo brings it back", () => {
    const store = new JackpopStore(new MemoryStorage());
    store.setVoice({ id: "take-one", startStep: 4, tempo: 150, muted: false });
    store.setVoice({ id: "take-two", startStep: 70, tempo: 150, muted: false });
    expect(store.project.value.voice).toEqual({ id: "take-two", startStep: 6, tempo: 150, muted: false });
    store.toggleVoiceMute();
    expect(store.project.value.voice?.muted).toBe(true);
    store.setVoice(null);
    store.undo();
    store.undo();
    store.undo();
    expect(store.project.value.voice?.id).toBe("take-one");
  });

  it("drops a voice with a strange id", () => {
    expect(sanitizeProject({ voice: { id: "../../etc", startStep: 1 } }).voice).toBeNull();
  });
});
