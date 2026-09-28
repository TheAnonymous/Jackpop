<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import type { VisualEvent } from "./audio/engine";
import { PopEngine } from "./audio/engine";
import CandyKnob from "./components/CandyKnob.vue";
import Confetti from "./components/Confetti.vue";
import DragValue from "./components/DragValue.vue";
import Lever from "./components/Lever.vue";
import Reel from "./components/Reel.vue";
import ReelSheet from "./components/ReelSheet.vue";
import { takeForcedSpin } from "./machine/forced";
import type { Jackpot } from "./machine/machine";
import { detectJackpot, spinPositions, wrap } from "./machine/machine";
import { buildLoop } from "./music/loop";
import type { Family, ReelId } from "./music/reels";
import { FAMILY_INFO, REEL_LABELS, REELS, STRIP_LENGTH, variantAt } from "./music/reels";
import type { KnobName } from "./store";
import { JackpopStore, MAX_TEMPO, MIN_TEMPO } from "./store";
import { versionLabel } from "./version";
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
const flashUntil = ref(0);
const now = ref(0);
const confetti = ref<InstanceType<typeof Confetti> | null>(null);

/** Where each reel is drawn: its strip position, with fractions while it moves. */
const display = shallowRef<Record<ReelId, number>>(positionsOf());
interface Motion { clock: "audio" | "ui"; from: number; to: number; start: number; stop: number }
const motions: Partial<Record<ReelId, Motion>> = {};
const moving = shallowRef<Record<ReelId, boolean>>(Object.fromEntries(REELS.map((reel) => [reel, false])) as Record<ReelId, boolean>);
let spinPending = false;
let bannerTimer: ReturnType<typeof setTimeout> | null = null;

function positionsOf(): Record<ReelId, number> {
  return Object.fromEntries(REELS.map((reel) => [reel, project.value.reels[reel].position])) as Record<ReelId, number>;
}

watch(loop, (value) => engine.setLoop(value));
watch(() => [project.value.knobs, project.value.tempo, project.value.volume], () => engine.setSettings(settings()));
watch(playing, (value) => { wakeLock.playing = value; });

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
  const landed = spinPositions(current.reels, Math.random);
  for (const reel of REELS) if (!held.has(reel) && forced?.[reel] !== undefined) landed[reel] = wrap(forced[reel]);
  const jackpot = detectJackpot(landed);

  spinPending = true;
  store.applySpin(landed);
  store.recordPull(jackpot);
  const plan = await engine.pull(strength, held, loop.value, jackpot);
  spinPending = false;
  if (!plan) {
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
    motions[reel] = { clock: "audio", from: display.value[reel], to: unwrapTarget(display.value[reel], landed[reel], stop - plan.start), start: plan.start, stop };
  }
}

/** The final strip position as a running number, so the reel travels forwards several turns. */
function unwrapTarget(from: number, target: number, seconds: number): number {
  const distance = ((target - wrap(from)) % STRIP_LENGTH + STRIP_LENGTH) % STRIP_LENGTH;
  const turns = Math.max(1, Math.round((seconds * 9 - distance) / STRIP_LENGTH));
  return Math.floor(from) + distance + turns * STRIP_LENGTH;
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
  const target = wrap(current + 1 + Math.floor(Math.random() * (STRIP_LENGTH - 1)));
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
  motions[reel] = { clock: "audio", from: display.value[reel], to: unwrapTarget(display.value[reel], target, stop - plan.start), start: plan.start, stop };
}

function setSolo(reel: ReelId, on: boolean): void {
  engine.setSolo(on ? reel : null);
}

function showBanner(text: string, family: Family, big: boolean): void {
  banner.value = { text, family, big };
  if (bannerTimer) clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => { banner.value = null; }, big ? 4_500 : 2_500);
}

function celebrate(jackpot: Jackpot): void {
  const info = FAMILY_INFO[jackpot.family];
  const mega = jackpot.count === 4;
  showBanner(`${jackpot.count} × ${info.symbol}: ${mega ? "Mega-Jackpot!" : "Jackpot!"}`, jackpot.family, true);
  confetti.value?.burst([info.color, "#ffd23f", "#ffffff", "#ff4fa3", "#2de2e6"], mega ? 220 : 140);
  flashUntil.value = performance.now() + 3_000;
  navigator.vibrate?.([40, 60, 40, 60, 120]);
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
      break;
    case "stop":
      navigator.vibrate?.(18);
      // A reel spun on its own has no drop to wait for: the machine is free once it lands.
      if (!engine.spinning) spinning.value = false;
      break;
    case "restart":
      spinning.value = false;
      announcement.value = describeLine();
      if (event.jackpot) celebrate(event.jackpot);
      break;
  }
}

let frame = 0;
function tick(): void {
  const audioNow = engine.visualTime();
  const uiNow = performance.now() / 1000;
  now.value = performance.now();
  for (const event of engine.drainEvents(audioNow)) handle(event);
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
  return Array.from({ length: BULBS }, (_, index) => {
    if (flashing) return (index + Math.floor(now.value / 120)) % 2 === 0;
    if (spinning.value) return (index + lightStep.value) % 3 === 0;
    if (playing.value) return (index + Math.floor(lightStep.value / 2)) % 4 === 0;
    return (index + Math.floor(now.value / 600)) % 5 === 0;
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
      <span class="stats" data-stats :aria-label="`${store.stats.value.pulls} ${store.stats.value.pulls === 1 ? 'Zug' : 'Züge'}, ${store.stats.value.jackpots} Jackpots`">
        <b>{{ store.stats.value.pulls }}</b> {{ store.stats.value.pulls === 1 ? "Zug" : "Züge" }} · <b>{{ store.stats.value.jackpots }}</b> <span aria-hidden="true">★</span>
      </span>
      <button type="button" class="help-button" aria-label="Hilfe" @click="helpOpen = true">?</button>
    </header>

    <main class="machine" :class="{ pulse: beatPulse }">
      <div class="cabinet">
        <div class="marquee" aria-hidden="true">
          <span v-for="(on, index) in bulbs" :key="index" class="bulb" :class="{ on }"></span>
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
      <Lever :locked="spinning" @pull="pull" @ratchet="(depth) => engine.ratchet(depth)" @grab="engine.unlock()" />
      <p v-if="hint" class="lever-hint" aria-hidden="true">Zieh!</p>
    </main>

    <p class="banner" :class="{ big: banner?.big, show: banner }" :style="{ '--family': banner ? FAMILY_INFO[banner.family].color : 'transparent' }" role="status" data-banner>
      {{ banner?.text ?? "" }}
    </p>
    <p v-if="notice" class="notice" role="alert" @click="notice = ''">{{ notice }}</p>
    <p class="sr" aria-live="polite">{{ announcement }}</p>

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

    <div v-if="helpOpen" class="sheet-backdrop" @click.self="closeHelp">
      <section class="sheet help" role="dialog" aria-modal="true" aria-labelledby="help-title">
        <h2 id="help-title">Jackpop</h2>
        <p>Eine Hit-Maschine: Jede Walze ist ein Teil deines Songs.</p>
        <ul>
          <li><b>Hebel runterziehen.</b> Die Walzen stoppen im Takt, eine nach der anderen, dann kommt der Drop. Ganz runterziehen dreht einen Takt länger.</li>
          <li><b>Halten</b> friert eine Walze für den nächsten Zug ein.</li>
          <li><b>▲▼ stupsen</b> eine Walze ein Symbol weiter.</li>
          <li><b>Symbol antippen</b> öffnet es: anderer Klang, höher oder tiefer, nur diese Walze drehen.</li>
          <li><b>Drei oder vier gleiche Symbole</b> auf der Linie sind ein Jackpot.</li>
          <li><b>Zucker, Glitzer, Chaos</b> drehst du mit dem Daumen hoch oder runter.</li>
        </ul>
        <p class="small">Drehen ist immer gratis. Alles bleibt auf diesem Handy. <span data-app-version>{{ appVersion }}</span></p>
        <button type="button" class="candy-button primary" data-help-close @click="closeHelp">Los geht's</button>
      </section>
    </div>

    <Confetti ref="confetti" />
  </div>
</template>
