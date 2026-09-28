import type { Family } from "../music/reels";

/*
 * Every ticket names its song after the line that made it: the hook's family
 * gives the first word, the beat's the second. "Mondschein-Party".
 */

const FIRST: Record<Family, string> = {
  sweet: "Zuckerwatte",
  sparkle: "Sternschnuppen",
  wild: "Blitzlicht",
  dreamy: "Mondschein",
  club: "Discofieber",
  anthem: "Kronjuwelen",
  rare: "Diamanten",
};

const SECOND: Record<Family, string> = {
  sweet: "Hüpfer",
  sparkle: "Glitzer",
  wild: "Gewitter",
  dreamy: "Träumerei",
  club: "Party",
  anthem: "Hymne",
  rare: "Jackpot",
};

export function songTitle(hook: Family, beat: Family): string {
  return `${FIRST[hook]}-${SECOND[beat]}`;
}

/** A file name from a title: lower case, umlauts spelled out, only letters, digits and dashes. */
export function fileSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "song";
}
