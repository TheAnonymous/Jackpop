<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import type { VisualEvent } from "./audio/engine";
import { PopEngine } from "./audio/engine";
import CandyKnob from "./components/CandyKnob.vue";
import CoinSlot, { type CoinState } from "./components/CoinSlot.vue";
import Confetti from "./components/Confetti.vue";
import DragValue from "./components/DragValue.vue";
import Lever from "./components/Lever.vue";
import MoodFace from "./components/MoodFace.vue";
import Reel from "./components/Reel.vue";
import ReelSheet from "./components/ReelSheet.vue";
import TicketSheet from "./components/TicketSheet.vue";
import { takeForcedSpin } from "./machine/forced";
import type { Jackpot, Mood } from "./machine/machine";
import { detectJackpot, giveInChance, moodOf, spinPositions, tipIntoJackpot, wrap } from "./machine/machine";
import { buildLoop } from "./music/loop";
import type { Family, ReelId } from "./music/reels";
import { FAMILY_INFO, REEL_LABELS, REELS, stripLength, variantAt } from "./music/reels";
import { SONG } from "./music/song";
import { chordPitchClasses } from "./music/theory";
import type { KnobName, Stats } from "./store";
import { JackpopStore, MAX_TEMPO, MIN_TEMPO } from "./store";
import { encodeSong } from "./ticket/encode";
import { recipeLink, readRecipe } from "./ticket/recipe";
import { renderSong, ticketSeconds, type TunedVoice } from "./ticket/render";
import { fileSlug, songTitle } from "./ticket/title";
import { versionLabel } from "./version";
import { Microphone } from "./voice/mic";
import { loadTake, saveTake, type StoredTake } from "./voice/storage";
import { VoiceTuner } from "./voice/tuner";
import { PlaybackWakeLock } from "./wake-lock";

const HELP_SEEN_KEY = "jackpop.help.seen";
const BULBS = 14;
const KNOBS: { name: KnobName; label: string; hint: string; color: string }[] = [
  { name: "sugar", label: "Zucker", hint: "höher, heller, süßer", color: "#ff4fa3" },
  { name: "glitter", label: "Glitzer", hint: "Glöckchen, Hall, Sparkles", color: "#ffd23f" },
  { name: "chaos", label: "Chaos", hint: "Glitches, Verzerrung, Stotterer", color: "#2de2e6" },
];

const store = new JackpopStore();
const project = store.project;
const loop = computed(() => buildLoop(project.value.key, project.value.reels));
const settings = () => ({ knobs: project.value.knobs, tempo: project.value.tempo, volume: project.value.volume });
const engine = new PopEngine(loop.value, settings(), { latencyHint: "balanced" });
const wakeLock = new PlaybackWakeLock();
const appVersion = versionLabel();

const playing = ref(false);
const spinning = ref(false);
const openReel = ref<ReelId | null>(null);
const helpOpen = ref(!readFlag(HELP_SEEN_KEY));
const hint = ref(store.stats.value.pulls === 0);
const notice = ref(store.restoredFromBackup ? "Der letzte Stand war beschädigt, die Sicherung davor ist geladen." : "");
const banner = ref<{ text: string; family: Family; big: boolean } | null>(null);
const announcement = ref("");
const lightStep = ref(0);
/** The section playing, from the audio clock: name and label. */
const section = ref<{ name: string; label: string }>({ name: "loop", label: "Loop" });
const flashUntil = ref(0);
const now = ref(0);
const confetti = ref<InstanceType<typeof Confetti> | null>(null);
const coinState = ref<CoinState>("idle");
const micLevel = ref(0);
const recordProgress = ref(0);
const voicedShare = ref<number | null>(null);
const mic = new Microphone();
const tuner = new VoiceTuner();
let takeCache: StoredTake | null = null;
/** The last tuned voice, kept for the ticket's offline render. */
let tunedVoice: TunedVoice | null = null;
interface Ticket {
  state: "printing" | "ready";
  progress: number;
  title: string;
  families: Family[];
  seconds: number;
  tempo: number;
  voice: boolean;
  url: string | null;
  file: File | null;
  format: "ogg" | "wav" | null;
}
const ticket = ref<Ticket | null>(null);
let coinHeld = false;
let recordStartedAt = 0;
let recordLimitMs = 0;
let recordTimer: ReturnType<typeof setTimeout> | null = null;
let retuneTimer: ReturnType<typeof setTimeout> | null = null;

/** Where each reel is drawn: its strip position, with fractions while it moves. */
const display = shallowRef<Record<ReelId, number>>(positionsOf());
interface Motion { clock: "audio" | "ui"; from: number; to: number; start: number; stop: number }
const motions: Partial<Record<ReelId, Motion>> = {};
const moving = shallowRef<Record<ReelId, boolean>>(Object.fromEntries(REELS.map((reel) => [reel, false])) as Record<ReelId, boolean>);
let spinPending = false;
let bannerTimer: ReturnType<typeof setTimeout> | null = null;

/** The stats as the machine shows them: a pull only counts once its reels have landed. */
const heldStats = shallowRef<Stats | null>(null);
const shownStats = computed(() => heldStats.value ?? store.stats.value);
const mood = computed(() => moodOf(shownStats.value.dry));
/** What the last pull did to the machine, told when its reels have stopped. */
let pullOutcome: { gaveIn: boolean; moodBefore: Mood } | null = null;

const lengths = computed(() => Object.fromEntries(REELS.map((reel) => [reel, stripLength(reel, store.stats.value.unlocked)])) as Record<ReelId, number>);

function positionsOf(): Record<ReelId, number> {
  return Object.fromEntries(REELS.map((reel) => [reel, project.value.reels[reel].position])) as Record<ReelId, number>;
}

watch(loop, (value) => engine.setLoop(value));
engine.setMode(project.value.mode);
watch(() => project.value.mode, (mode) => engine.setMode(mode));
watch(() => [project.value.knobs, project.value.tempo, project.value.volume], () => engine.setSettings(settings()));
watch(playing, (value) => { wakeLock.playing = value; });

// ---- the coin slot: your voice in the song ----------------------------------

const scale = computed(() => {
  const tonic = chordPitchClasses(project.value.key, { degree: 0 })[0]!;
  return [0, 2, 4, 5, 7, 9, 11].map((offset) => (tonic + offset) % 12);
});
const tuneKey = computed(() => JSON.stringify([project.value.voice, loop.value.melody, project.value.tempo, Math.round(project.value.knobs.sugar * 20), scale.value]));
watch(tuneKey, () => scheduleRetune(250));
engine.onceCreated(() => scheduleRetune(0));

function scheduleRetune(delay: number): void {
  if (retuneTimer) clearTimeout(retuneTimer);
  retuneTimer = setTimeout(() => void retune(), delay);
}

/** Tunes the current take to the current hook, tempo and sugar, and hands it to the engine. */
async function retune(): Promise<void> {
  const voice = project.value.voice;
  const context = engine.audioContext;
  if (!voice || voice.muted) {
    engine.setVoice(null);
    tunedVoice = null;
    if (coinState.value === "tuning") coinState.value = "idle";
    return;
  }
  if (!context) return;
  if (takeCache?.id !== voice.id) takeCache = await loadTake(voice.id).catch(() => null);
  const take = takeCache;
  if (!take || project.value.voice?.id !== voice.id) {
    if (!take) engine.setVoice(null);
    return;
  }
  const job = {
    samples: take.samples,
    sampleRate: take.sampleRate,
    recordedTempo: voice.tempo,
    tempo: project.value.tempo,
    startStep: voice.startStep,
    targets: loop.value.melody,
    scale: scale.value,
    sugar: project.value.knobs.sugar,
  };
  // The second take sings the lifted chorus, a whole tone up with everything else.
  const results = await tuner.tune([job, { ...job, targets: job.targets.map((note) => (note === null ? null : note + 2)), scale: job.scale.map((pc) => (pc + 2) % 12) }]);
  if (!results || project.value.voice?.id !== voice.id) return;
  tunedVoice = { base: results[0]!.samples, lifted: results[1]!.samples, sampleRate: results[0]!.sampleRate };
  const [result, lifted] = results.map((tuned) => {
    const buffer = context.createBuffer(1, tuned.samples.length, tuned.sampleRate);
    buffer.getChannelData(0).set(tuned.samples);
    return { buffer, voicedShare: tuned.voicedShare };
  }) as [{ buffer: AudioBuffer; voicedShare: number }, { buffer: AudioBuffer; voicedShare: number }];
  engine.setVoice(result.buffer, lifted.buffer);
  voicedShare.value = Math.round(result.voicedShare * 100) / 100;
  if (coinState.value === "tuning") {
    coinState.value = "idle";
    engine.coin();
    navigator.vibrate?.([20, 40, 20]);
    showBanner(result.voicedShare < 0.15 ? "Kaum Gesang gehört. Sing lauter oder näher ran!" : "Stimme ist drin!", "sparkle", false);
  }
}

function micProblem(error: unknown): string {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "Kein Mikrofon gefunden.";
  if (name === "NotAllowedError" || name === "SecurityError") return "Das Mikrofon ist gesperrt. Erlaube es für diese Seite über das Schloss neben der Adresse.";
  return "Das Mikrofon ließ sich nicht öffnen.";
}

async function coinPress(): Promise<void> {
  if (engine.spinning || spinPending || coinState.value !== "idle") return;
  coinHeld = true;
  if (!Microphone.supported()) {
    notice.value = "Dieser Browser kann hier nicht aufnehmen.";
    return;
  }
  if (!(await engine.unlock())) {
    notice.value = "Der Browser lässt noch keinen Ton zu. Tippe noch einmal.";
    return;
  }
  if (!mic.open) {
    coinState.value = "arming";
    try {
      await mic.openOn(engine.audioContext!);
    } catch (error) {
      coinState.value = "idle";
      notice.value = micProblem(error);
      return;
    }
    coinState.value = "idle";
    if (!coinHeld) {
      showBanner("Mikrofon ist bereit. Halten und singen!", "sparkle", false);
      return;
    }
  }
  if (!coinHeld) return;
  if (!engine.playing) playing.value = await engine.start();
  hint.value = false;
  notice.value = "";
  engine.setRecording(true);
  mic.start();
  coinState.value = "recording";
  recordStartedAt = performance.now();
  recordLimitMs = engine.loopSeconds * 1000;
  recordTimer = setTimeout(() => void coinRelease(), recordLimitMs);
}

async function coinRelease(): Promise<void> {
  coinHeld = false;
  if (coinState.value !== "recording") return;
  if (recordTimer) clearTimeout(recordTimer);
  coinState.value = "tuning";
  recordProgress.value = 0;
  const recorded = await mic.stop();
  engine.setRecording(false);
  if (recorded.samples.length / recorded.sampleRate < 0.4) {
    coinState.value = "idle";
    showBanner("Halt den Schlitz länger gedrückt und sing!", "sparkle", false);
    return;
  }
  const context = engine.audioContext!;
  const latency = recorded.inputLatency + (context.outputLatency || context.baseLatency || 0);
  const take: StoredTake = { id: `take-${Date.now().toString(36)}`, samples: recorded.samples, sampleRate: recorded.sampleRate, createdAt: Date.now() };
  takeCache = take;
  saveTake(take).catch(() => { notice.value = "Die Stimme spielt, ließ sich aber nicht auf dem Handy speichern."; });
  store.setVoice({ id: take.id, startStep: engine.loopPositionAt(recorded.startTime - latency), tempo: project.value.tempo, muted: false });
  scheduleRetune(0);
}

// ---- the ticket: share the song ------------------------------------------------

function currentTitle(): string {
  const reels = project.value.reels;
  return songTitle(variantAt("hook", reels.hook.position).family, variantAt("beat", reels.beat.position).family);
}

/** Prints the ticket: the line rendered as a whole song, voice included, encoded for sharing. */
async function printTicket(): Promise<void> {
  if (ticket.value?.state === "printing" || engine.spinning || coinState.value !== "idle") return;
  if (playing.value) await togglePlay();
  const title = currentTitle();
  const voice = project.value.voice && !project.value.voice.muted ? tunedVoice : null;
  ticket.value = {
    state: "printing",
    progress: 0,
    title,
    families: REELS.map((reel) => variantAt(reel, project.value.reels[reel].position).family),
    seconds: ticketSeconds(project.value.tempo) - 2.5,
    tempo: project.value.tempo,
    voice: voice !== null,
    url: null,
    file: null,
    format: null,
  };
  navigator.vibrate?.([15, 30, 15, 30, 15]);
  try {
    const buffer = await renderSong(loop.value, { knobs: project.value.knobs, tempo: project.value.tempo, volume: 0.9 }, voice, (share) => {
      if (ticket.value) ticket.value = { ...ticket.value, progress: share * 0.92 };
    });
    const encoded = await encodeSong(buffer, title);
    if (!ticket.value) return;
    const file = new File([encoded.blob], `jackpop-${fileSlug(title)}.${encoded.extension}`, { type: encoded.type });
    ticket.value = { ...ticket.value, state: "ready", progress: 1, file, url: URL.createObjectURL(file), format: encoded.extension };
    navigator.vibrate?.(30);
  } catch (error) {
    console.error(error);
    closeTicket();
    notice.value = "Das Ticket ließ sich nicht drucken.";
  }
}

function closeTicket(): void {
  if (ticket.value?.url) URL.revokeObjectURL(ticket.value.url);
  ticket.value = null;
}

function saveFile(file: File): void {
  const link = document.createElement("a");
  link.href = ticket.value?.url ?? URL.createObjectURL(file);
  link.download = file.name;
  link.click();
}

async function shareSong(): Promise<void> {
  const file = ticket.value?.file;
  if (!file) return;
  const data = { files: [file], title: ticket.value!.title, text: `Mein Jackpop-Hit: ${ticket.value!.title}` };
  if (typeof navigator.share === "function" && navigator.canShare?.(data)) {
    await navigator.share(data).catch(() => undefined);
  } else {
    saveFile(file);
    showBanner("Kein Teilen-Menü hier: das Ticket wird gespeichert.", "sparkle", false);
  }
}

async function shareRecipe(): Promise<void> {
  const url = recipeLink(`${location.origin}${location.pathname}`, project.value);
  const title = ticket.value?.title ?? currentTitle();
  if (typeof navigator.share === "function") {
    await navigator.share({ title, text: `Zieh am Hebel und sing selbst mit: mein Jackpop-Rezept „${title}“`, url }).catch(() => undefined);
    return;
  }
  try {
    await navigator.clipboard.writeText(url);
    showBanner("Rezept-Link kopiert.", "sparkle", false);
  } catch {
    notice.value = `Dein Rezept-Link: ${url}`;
  }
}

/** A friend's recipe from the address: their line, your voice. Undo brings your own back. */
function importRecipe(): void {
  const recipe = readRecipe(location.hash);
  if (!location.hash.includes("rezept=")) return;
  history.replaceState(null, "", `${location.pathname}${location.search}`);
  if (!recipe) {
    notice.value = "Dieser Rezept-Link ist beschädigt.";
    return;
  }
  const gifts = store.grantDiamonds(recipe.diamonds);
  store.edit((draft) => Object.assign(draft, recipe.apply(draft)));
  display.value = positionsOf();
  hint.value = false;
  const gift = gifts.length > 0 ? ` Dazu ${gifts.length === 1 ? "ein Diamant" : `${gifts.length} Diamanten`} als Geschenk!` : "";
  showBanner(`Rezept geladen: ${currentTitle()}.${gift}`, gifts.length > 0 ? "rare" : "sweet", false, 4_500);
}

function removeVoice(): void {
  store.setVoice(null);
  voicedShare.value = null;
}

// ---- the lever ------------------------------------------------------------

async function pull(strength: number): Promise<void> {
  if (engine.spinning || spinPending) return;
  hint.value = false;
  const current = project.value;
  const held = new Set(REELS.filter((reel) => current.reels[reel].held));
  if (held.size === REELS.length) {
    showBanner("Alle Walzen gehalten. Löse eine, dann dreh!", "sweet", false);
    return;
  }
  const forced = takeForcedSpin();
  let landed = spinPositions(current.reels, Math.random, lengths.value);
  for (const reel of REELS) if (!held.has(reel) && forced?.[reel] !== undefined) landed[reel] = wrap(forced[reel], lengths.value[reel]);
  let jackpot = detectJackpot(landed);
  // An impatient machine sometimes gives in, and at the latest after fourteen dry pulls.
  let gaveIn = false;
  if (!forced && !jackpot && Math.random() < giveInChance(store.stats.value.dry)) {
    const tipped = tipIntoJackpot(landed, current.reels, lengths.value, Math.random);
    if (tipped) {
      landed = tipped;
      jackpot = detectJackpot(landed);
      gaveIn = jackpot !== null;
    }
  }
  pullOutcome = { gaveIn, moodBefore: mood.value };

  spinPending = true;
  heldStats.value = store.stats.value;
  store.applySpin(landed);
  store.recordPull(jackpot);
  const plan = await engine.pull(strength, held, loop.value, jackpot);
  spinPending = false;
  if (!plan) {
    heldStats.value = null;
    pullOutcome = null;
    notice.value = "Der Browser lässt noch keinen Ton zu. Zieh gleich noch einmal.";
    display.value = positionsOf();
    return;
  }
  notice.value = "";
  playing.value = true;
  spinning.value = true;
  announcement.value = "Die Walzen drehen sich.";
  for (const reel of REELS) {
    const stop = plan.stops[reel];
    if (stop === undefined) continue;
    motions[reel] = { clock: "audio", from: display.value[reel], to: unwrapTarget(display.value[reel], landed[reel], stop - plan.start, lengths.value[reel]), start: plan.start, stop };
  }
}

/** The final strip position as a running number, so the reel travels forwards several turns. */
function unwrapTarget(from: number, target: number, seconds: number, length: number): number {
  const distance = ((target - wrap(from, length)) % length + length) % length;
  const turns = Math.max(1, Math.round((seconds * 9 - distance) / length));
  return Math.floor(from) + distance + turns * length;
}

function motionAt(motion: Motion, time: number): number {
  if (time <= motion.start) return motion.from;
  if (time < motion.stop) {
    const progress = (time - motion.start) / (motion.stop - motion.start);
    // Slow start, full speed at the stop: the reel slams in.
    return motion.from + (motion.to - motion.from) * ((progress * progress + progress) / 2);
  }
  const after = time - motion.stop;
  return motion.to + (motion.clock === "audio" ? 0.16 * Math.sin(after * 30) * Math.exp(-after * 13) : 0);
}

// ---- other controls -------------------------------------------------------

function toggleHold(reel: ReelId): void {
  store.toggleHold(reel);
  engine.clunk();
  navigator.vibrate?.(10);
}

function nudge(reel: ReelId, delta: number): void {
  if (engine.spinning || spinPending) return;
  const from = display.value[reel];
  // Quick taps add up: a nudge during a nudge heads on from where that one was going.
  const running = motions[reel];
  const base = running?.clock === "ui" ? running.to : Math.round(from);
  store.nudge(reel, delta);
  const t = performance.now() / 1000;
  motions[reel] = { clock: "ui", from, to: base + delta, start: t, stop: t + 0.14 };
  engine.tick();
  engine.preview(reel, loop.value);
  navigator.vibrate?.(8);
}

async function togglePlay(): Promise<void> {
  if (playing.value) {
    engine.stop();
    playing.value = false;
    spinning.value = false;
    heldStats.value = null;
    pullOutcome = null;
    for (const reel of REELS) delete motions[reel];
    display.value = positionsOf();
    engine.setSolo(null);
    return;
  }
  hint.value = false;
  playing.value = await engine.start();
  if (!playing.value) notice.value = "Der Browser lässt noch keinen Ton zu. Tippe noch einmal auf Play.";
}

function setSound(reel: ReelId, sound: string): void {
  store.setSound(reel, sound);
  engine.preview(reel, loop.value);
}

function setShift(reel: ReelId, shift: number): void {
  store.setShift(reel, shift);
  engine.preview(reel, loop.value);
}

async function spinOne(reel: ReelId): Promise<void> {
  if (engine.spinning || spinPending) return;
  const current = project.value.reels[reel].position;
  const length = lengths.value[reel];
  const target = wrap(current + 1 + Math.floor(Math.random() * (length - 1)), length);
  spinPending = true;
  store.applySpin({ [reel]: target });
  const plan = await engine.spinReel(reel, loop.value);
  spinPending = false;
  openReel.value = null;
  if (!plan) {
    display.value = positionsOf();
    return;
  }
  playing.value = true;
  spinning.value = true;
  const stop = plan.stops[reel]!;
  motions[reel] = { clock: "audio", from: display.value[reel], to: unwrapTarget(display.value[reel], target, stop - plan.start, length), start: plan.start, stop };
}

function setSolo(reel: ReelId, on: boolean): void {
  engine.setSolo(on ? reel : null);
}

function showBanner(text: string, family: Family, big: boolean, duration = big ? 3_000 : 2_500): void {
  banner.value = { text, family, big };
  if (bannerTimer) clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => { banner.value = null; }, duration);
}

function celebrate(jackpot: Jackpot): void {
  const info = FAMILY_INFO[jackpot.family];
  const mega = jackpot.count === 4;
  const title = jackpot.family === "rare" ? "Diamant-Jackpot!" : mega ? "Mega-Jackpot!" : "Jackpot!";
  const joker = jackpot.jokers > 0 && jackpot.family !== "rare" ? " mit Joker" : "";
  const relief = pullOutcome?.gaveIn ? "Endlich! " : "";
  showBanner(`${relief}${jackpot.count} × ${info.symbol}${joker}: ${title}`, jackpot.family, true);
  confetti.value?.burst([info.color, "#ffd23f", "#ffffff", "#ff4fa3", "#2de2e6"], mega ? 220 : 140);
  flashUntil.value = performance.now() + 3_000;
  navigator.vibrate?.([40, 60, 40, 60, 120]);
  // Every jackpot unlocks a diamond on the next reel, until all four have one.
  const unlocked = store.unlockNext();
  if (unlocked) {
    setTimeout(() => {
      showBanner(`Neu: ein Diamant auf der ${REEL_LABELS[unlocked]}-Walze! Er zählt als Joker.`, "rare", false, 4_500);
      confetti.value?.burst([FAMILY_INFO.rare.color, "#ffffff"], 60);
      engine.coin();
    }, 3_000);
  }
}

/** After a pull without a jackpot: grumble when impatient, say so when the mood tips over. */
function tellMood(): void {
  const before = pullOutcome?.moodBefore ?? "happy";
  if (mood.value === "happy") return;
  engine.grumble();
  if (mood.value === before) return;
  if (mood.value === "impatient") showBanner("Die Maschine wird ungeduldig …", "club", false, 3_000);
  else showBanner("Die Maschine kocht! Lange hält sie das nicht aus.", "club", false, 3_500);
  navigator.vibrate?.([10, 40, 10]);
}

function describeLine(): string {
  return REELS.map((reel) => {
    const variant = variantAt(reel, project.value.reels[reel].position);
    return `${REEL_LABELS[reel]}: ${FAMILY_INFO[variant.family].symbol}`;
  }).join(", ");
}

// ---- the frame loop: events from the audio clock move the screen ------------

function handle(event: VisualEvent): void {
  switch (event.type) {
    case "step":
      lightStep.value = event.loopStep;
      if (event.section !== section.value.name || event.label !== section.value.label) section.value = { name: event.section, label: event.label };
      break;
    case "end":
      void togglePlay();
      showBanner("Song ist durch. Zieh für den nächsten!", "sparkle", false, 3_500);
      break;
    case "stop":
      navigator.vibrate?.(18);
      // A reel spun on its own has no drop to wait for: the machine is free once it lands.
      if (!engine.spinning) spinning.value = false;
      break;
    case "restart":
      spinning.value = false;
      heldStats.value = null;
      announcement.value = describeLine();
      if (event.jackpot) celebrate(event.jackpot);
      else tellMood();
      pullOutcome = null;
      break;
  }
}

let frame = 0;
function tick(): void {
  const audioNow = engine.visualTime();
  const uiNow = performance.now() / 1000;
  now.value = performance.now();
  for (const event of engine.drainEvents(audioNow)) handle(event);
  if (coinState.value === "recording") {
    micLevel.value = mic.level();
    recordProgress.value = Math.min(1, (performance.now() - recordStartedAt) / recordLimitMs);
  } else if (micLevel.value !== 0) {
    micLevel.value = 0;
  }
  const next = { ...display.value };
  const nextMoving = { ...moving.value };
  let changed = false;
  for (const reel of REELS) {
    const motion = motions[reel];
    let position: number;
    let isMoving = false;
    if (motion) {
      const time = motion.clock === "audio" ? audioNow : uiNow;
      position = motionAt(motion, time);
      isMoving = time < motion.stop;
      if (time > motion.stop + 0.45) {
        delete motions[reel];
        position = project.value.reels[reel].position;
      }
    } else {
      position = spinPending ? display.value[reel] : project.value.reels[reel].position;
    }
    if (position !== next[reel]) {
      next[reel] = position;
      changed = true;
    }
    if (isMoving !== nextMoving[reel]) {
      nextMoving[reel] = isMoving;
      changed = true;
    }
  }
  if (changed) {
    display.value = next;
    moving.value = nextMoving;
  }
  frame = requestAnimationFrame(tick);
}

// ---- the lights -------------------------------------------------------------

const bulbs = computed(() => {
  const flashing = now.value < flashUntil.value;
  const pace = mood.value === "hot" ? 3 : mood.value === "impatient" ? 1.8 : 1;
  return Array.from({ length: BULBS }, (_, index) => {
    if (flashing) return (index + Math.floor(now.value / 120)) % 2 === 0;
    if (spinning.value) return (index + lightStep.value) % 3 === 0;
    if (playing.value) return mood.value === "hot" ? (index + lightStep.value) % 2 === 0 : (index + Math.floor((lightStep.value * pace) / 2)) % 4 === 0;
    return (index + Math.floor((now.value * pace) / 600)) % (mood.value === "happy" ? 5 : 3) === 0;
  });
});
const beatPulse = computed(() => playing.value && lightStep.value % 4 === 0);

// ---- little helpers -----------------------------------------------------------

function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function closeHelp(): void {
  helpOpen.value = false;
  try {
    localStorage.setItem(HELP_SEEN_KEY, "1");
  } catch {
    // Without storage the help simply shows again next time.
  }
  void engine.unlock();
}

function keydown(event: KeyboardEvent): void {
  const target = event.target as HTMLElement | null;
  if (target?.closest("input, select, textarea, [role='spinbutton'], [role='slider'], [data-lever]")) return;
  const mod = event.ctrlKey || event.metaKey;
  if (event.key === " ") {
    event.preventDefault();
    void togglePlay();
  } else if (mod && event.key.toLowerCase() === "z" && !engine.spinning) {
    event.preventDefault();
    if (event.shiftKey) store.redo();
    else store.undo();
  }
}

function wake(): void {
  if (document.visibilityState === "visible" && playing.value) void engine.unlock();
}

onMounted(() => {
  importRecipe();
  frame = requestAnimationFrame(tick);
  window.addEventListener("keydown", keydown);
  document.addEventListener("visibilitychange", wake);
  // The first tap anywhere lets the audio start, so the lever's ratchet is heard from the first pull.
  window.addEventListener("pointerup", () => void engine.unlock(), { once: true });
});

onBeforeUnmount(() => {
  cancelAnimationFrame(frame);
  window.removeEventListener("keydown", keydown);
  document.removeEventListener("visibilitychange", wake);
  wakeLock.playing = false;
  mic.close();
  tuner.dispose();
  closeTicket();
  engine.dispose();
});
</script>

<template>
  <div class="app">
    <header class="topbar">
      <button type="button" class="play" :class="{ on: playing }" :aria-pressed="playing" data-play @click="togglePlay">
        <span aria-hidden="true">{{ playing ? "■" : "▶" }}</span><span class="sr">{{ playing ? "Stopp" : "Play" }}</span>
      </button>
      <DragValue :value="project.tempo" :min="MIN_TEMPO" :max="MAX_TEMPO" label="BPM" @change="(tempo) => store.setTempo(tempo)" />
      <div class="history">
        <button type="button" :disabled="!store.canUndo.value || spinning" aria-label="Rückgängig" data-undo @click="store.undo()">↶</button>
        <button type="button" :disabled="!store.canRedo.value || spinning" aria-label="Wiederholen" data-redo @click="store.redo()">↷</button>
      </div>
      <span class="stats" data-stats :aria-label="`${shownStats.pulls} ${shownStats.pulls === 1 ? 'Zug' : 'Züge'}, ${shownStats.jackpots} Jackpots`">
        <b>{{ shownStats.pulls }}</b> {{ shownStats.pulls === 1 ? "Zug" : "Züge" }} · <b>{{ shownStats.jackpots }}</b> <span aria-hidden="true">★</span>
      </span>
      <button type="button" class="ticket-button" :disabled="spinning || coinState !== 'idle'" aria-label="Ticket drucken: den Song teilen" data-ticket @click="printTicket">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2a3 3 0 0 0 0 6v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a3 3 0 0 0 0-6z" fill="currentColor" /><path d="M14 5v14" stroke="#3a1147" stroke-width="1.6" stroke-dasharray="2 2" /></svg>
        Ticket
      </button>
      <button type="button" class="help-button" aria-label="Hilfe" @click="helpOpen = true">?</button>
    </header>

    <main class="machine" :class="{ pulse: beatPulse }">
      <div class="cabinet" :class="`mood-${mood}`">
        <div class="marquee">
          <span v-for="(on, index) in bulbs.slice(0, BULBS / 2)" :key="index" class="bulb" :class="{ on }" aria-hidden="true"></span>
          <MoodFace :mood="mood" />
          <span v-for="(on, index) in bulbs.slice(BULBS / 2)" :key="`right-${index}`" class="bulb" :class="{ on }" aria-hidden="true"></span>
        </div>
        <h1 class="sign" aria-label="Jackpop">
          <span v-for="(letter, index) in 'JACKPOP'" :key="index" :style="{ '--i': index }">{{ letter }}</span>
        </h1>
        <div class="reel-labels" aria-hidden="true">
          <span v-for="reel in REELS" :key="reel">{{ REEL_LABELS[reel] }}</span>
        </div>
        <div class="window">
          <Reel
            v-for="reel in REELS"
            :key="reel"
            :reel="reel"
            :position="display[reel]"
            :spinning="moving[reel]"
            :held="project.reels[reel].held"
            :length="lengths[reel]"
            @open="openReel = reel"
          />
          <span class="payline" aria-hidden="true"></span>
        </div>
        <div class="holds">
          <button
            v-for="reel in REELS"
            :key="reel"
            type="button"
            class="hold"
            :class="{ on: project.reels[reel].held }"
            :aria-pressed="project.reels[reel].held"
            :aria-label="`${REEL_LABELS[reel]} halten`"
            :data-hold="reel"
            @click="toggleHold(reel)"
          >
            Halten
          </button>
        </div>
        <div class="nudges">
          <span v-for="reel in REELS" :key="reel" class="nudge-pair">
            <button type="button" class="nudge" :aria-label="`${REEL_LABELS[reel]} hochstupsen`" :data-nudge-up="reel" :disabled="spinning" @click="nudge(reel, -1)">▲</button>
            <button type="button" class="nudge" :aria-label="`${REEL_LABELS[reel]} runterstupsen`" :data-nudge-down="reel" :disabled="spinning" @click="nudge(reel, 1)">▼</button>
          </span>
        </div>
      </div>
      <Lever :locked="spinning || coinState === 'recording'" @pull="pull" @ratchet="(depth) => engine.ratchet(depth)" @grab="engine.unlock()" />
      <p v-if="hint" class="lever-hint" aria-hidden="true">Zieh!</p>
    </main>

    <div class="status-row">
      <button
        type="button"
        class="mode"
        :aria-pressed="project.mode === 'song'"
        :aria-label="project.mode === 'song' ? 'Song-Modus, zu Loop wechseln' : 'Loop-Modus, zu Song wechseln'"
        data-mode
        @click="store.setMode(project.mode === 'song' ? 'loop' : 'song')"
      >
        <span :class="{ on: project.mode === 'loop' }">Loop</span><span :class="{ on: project.mode === 'song' }">Song</span>
      </button>
      <div class="status">
        <div v-if="project.mode === 'song'" class="song-map" :class="{ dim: banner }" aria-hidden="true">
          <span v-for="part in SONG" :key="part.name" class="song-part" :class="{ now: playing && section.name === part.name }" :style="{ flexGrow: part.bars }"></span>
        </div>
        <span v-if="!banner && playing && (project.mode === 'song' || section.name !== 'loop')" class="section-label" data-section>{{ section.label }}</span>
        <p class="banner" :class="{ big: banner?.big, show: banner }" :style="{ '--family': banner ? FAMILY_INFO[banner.family].color : 'transparent' }" role="status" data-banner>
          {{ banner?.text ?? "" }}
        </p>
      </div>
    </div>
    <p v-if="notice" class="notice" role="alert" @click="notice = ''">{{ notice }}</p>
    <p class="sr" aria-live="polite">{{ announcement }}</p>

    <CoinSlot
      :state="coinState"
      :has-voice="project.voice !== null"
      :muted="project.voice?.muted ?? false"
      :level="micLevel"
      :progress="recordProgress"
      :locked="spinning"
      :data-voiced="voicedShare ?? ''"
      @press="coinPress"
      @release="coinRelease"
      @mute="store.toggleVoiceMute()"
      @remove="removeVoice"
    />

    <section class="candies" aria-label="Bonbon-Regler">
      <CandyKnob
        v-for="knob in KNOBS"
        :key="knob.name"
        :name="knob.name"
        :label="knob.label"
        :hint="knob.hint"
        :color="knob.color"
        :value="project.knobs[knob.name]"
        @change="(value) => store.setKnob(knob.name, value)"
      />
    </section>

    <ReelSheet
      v-if="openReel"
      :reel="openReel"
      :setting="project.reels[openReel]"
      :locked="spinning"
      @close="openReel = null; engine.setSolo(null)"
      @sound="(sound) => setSound(openReel!, sound)"
      @shift="(shift) => setShift(openReel!, shift)"
      @spin="spinOne(openReel!)"
      @solo="(on) => setSolo(openReel!, on)"
    />

    <TicketSheet
      v-if="ticket"
      :state="ticket.state"
      :progress="ticket.progress"
      :title="ticket.title"
      :families="ticket.families"
      :seconds="ticket.seconds"
      :tempo="ticket.tempo"
      :voice="ticket.voice"
      :url="ticket.url"
      :format="ticket.format"
      @share="shareSong"
      @recipe="shareRecipe"
      @save="ticket.file && saveFile(ticket.file)"
      @close="closeTicket"
    />

    <div v-if="helpOpen" class="sheet-backdrop" @click.self="closeHelp">
      <section class="sheet help" role="dialog" aria-modal="true" aria-labelledby="help-title">
        <h2 id="help-title">Jackpop</h2>
        <p>Eine Hit-Maschine: Jede Walze ist ein Teil deines Songs.</p>
        <ul>
          <li><b>Hebel runterziehen.</b> Die Walzen stoppen im Takt, eine nach der anderen, dann kommt der Drop. Ganz runterziehen dreht einen Takt länger.</li>
          <li><b>Halten</b> friert eine Walze für den nächsten Zug ein.</li>
          <li><b>▲▼ stupsen</b> eine Walze ein Symbol weiter.</li>
          <li><b>Symbol antippen</b> öffnet es: anderer Klang, höher oder tiefer, solo hören, nur diese Walze drehen.</li>
          <li><b>Drei oder vier gleiche Symbole</b> auf der Linie sind ein Jackpot: erst ein Bonus-Drop, dann eine Runde höher. Jeder Jackpot schaltet einen <b>Diamanten</b> frei, der als Joker zählt.</li>
          <li><b>Loop oder Song:</b> Song macht aus deiner Linie ein Stück mit Intro, Strophe, Refrain, Drop, Rückung und Outro.</li>
          <li><b>Münzschlitz gedrückt halten und singen:</b> Deine Stimme singt dann die Hook mit, hochgepitcht. Zucker macht sie höher.</li>
          <li><b>Zucker, Glitzer, Chaos</b> drehst du mit dem Daumen hoch oder runter.</li>
          <li><b>Die Laune:</b> Das Gesicht in der Lichterkette zeigt, wie lange die Maschine schon keinen Jackpot hatte. Wird sie ungeduldig oder kocht sie, gibt sie immer öfter nach.</li>
          <li><b>Ticket</b> druckt deinen Song als Audiodatei, zum Teilen per WhatsApp und Co. Der Rezept-Link schickt die Linie ohne deine Stimme: Freunde singen selbst.</li>
        </ul>
        <p class="small">Drehen ist immer gratis. Alles bleibt auf diesem Handy, auch deine Stimme. <span data-app-version>{{ appVersion }}</span></p>
        <button type="button" class="candy-button primary" data-help-close @click="closeHelp">Los geht's</button>
      </section>
    </div>

    <Confetti ref="confetti" />
  </div>
</template>
