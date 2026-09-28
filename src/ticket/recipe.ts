import type { ReelSetting } from "../music/loop";
import type { ReelId } from "../music/reels";
import { REELS, soundsFor, STRIP_LENGTH } from "../music/reels";
import type { Project } from "../store";
import { sanitizeProject } from "../store";

/*
 * The recipe link: everything that makes the song except the voice, packed
 * into the address after `#rezept=`. The fragment never reaches the server;
 * whoever opens the link gets their own copy and sings themselves.
 */

const PARAMETER = "rezept";

interface RecipeData {
  v: 1;
  k: string;
  t: number;
  m: "loop" | "song";
  n: [number, number, number];
  r: [position: number, sound: number, shift: number][];
}

function toBase64Url(text: string): string {
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): string {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4);
  return atob(padded);
}

export function encodeRecipe(project: Project): string {
  const round = (value: number) => Math.round(value * 100) / 100;
  const data: RecipeData = {
    v: 1,
    k: project.key,
    t: project.tempo,
    m: project.mode,
    n: [round(project.knobs.sugar), round(project.knobs.glitter), round(project.knobs.chaos)],
    r: REELS.map((reel) => {
      const setting = project.reels[reel];
      return [setting.position, setting.sound === null ? -1 : soundsFor(reel).indexOf(setting.sound), setting.shift];
    }),
  };
  return toBase64Url(JSON.stringify(data));
}

export function recipeLink(base: string, project: Project): string {
  return `${base}#${PARAMETER}=${encodeRecipe(project)}`;
}

export interface Recipe {
  /** The recipe applied to a project: your own voice and volume stay. */
  apply: (project: Project) => Project;
  /** Reels whose diamond the recipe uses. */
  diamonds: ReelId[];
}

/** Reads a recipe from a location hash; `null` when there is none or it is broken. */
export function readRecipe(hash: string): Recipe | null {
  const match = new RegExp(`[#&]${PARAMETER}=([A-Za-z0-9_-]{8,2000})`).exec(hash);
  if (!match) return null;
  let data: Partial<RecipeData>;
  try {
    data = JSON.parse(fromBase64Url(match[1]!)) as Partial<RecipeData>;
  } catch {
    return null;
  }
  if (data.v !== 1 || !Array.isArray(data.r) || data.r.length !== REELS.length) return null;
  const reels = Object.fromEntries(REELS.map((reel, index) => {
    const entry = Array.isArray(data.r![index]) ? data.r![index]! : [0, -1, 0];
    const sounds = soundsFor(reel);
    const sound = typeof entry[1] === "number" && entry[1] >= 0 && entry[1] < sounds.length ? sounds[entry[1]]! : null;
    return [reel, { position: Number(entry[0]), held: false, sound, shift: Number(entry[2]) } satisfies ReelSetting];
  })) as Record<ReelId, ReelSetting>;
  const knobs = Array.isArray(data.n) ? data.n : [];
  const incoming = sanitizeProject({ key: data.k, tempo: data.t, mode: data.m, knobs: { sugar: knobs[0], glitter: knobs[1], chaos: knobs[2] }, reels });
  return {
    diamonds: REELS.filter((reel) => incoming.reels[reel].position >= STRIP_LENGTH),
    apply: (project) => sanitizeProject({ ...incoming, voice: project.voice, volume: project.volume }),
  };
}
