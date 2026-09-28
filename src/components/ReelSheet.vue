<script setup lang="ts">
import { computed } from "vue";
import type { ReelSetting } from "../music/loop";
import type { ReelId } from "../music/reels";
import { defaultSound, FAMILY_INFO, REEL_LABELS, SOUND_LABELS, soundsFor, variantAt } from "../music/reels";
import SymbolIcon from "./SymbolIcon.vue";

/** An opened symbol: its sound, its register and a spin of its own. */
const props = defineProps<{ reel: ReelId; setting: ReelSetting; locked: boolean }>();
const emit = defineEmits<{
  close: [];
  sound: [sound: string];
  shift: [shift: number];
  spin: [];
  solo: [on: boolean];
}>();

const variant = computed(() => variantAt(props.reel, props.setting.position));
const sounds = computed(() => soundsFor(props.reel));
const sound = computed(() => props.setting.sound ?? defaultSound(variant.value));
const shiftLabels = computed(() => (props.reel === "beat" ? ["leichter", "normal", "voller"] : ["tiefer", "normal", "höher"]));

function cycle(direction: number): void {
  const list = sounds.value;
  const index = list.indexOf(sound.value);
  emit("sound", list[(index + direction + list.length) % list.length]!);
}

function setShift(delta: number): void {
  const next = Math.max(-1, Math.min(1, props.setting.shift + delta));
  if (next !== props.setting.shift) emit("shift", next);
}
</script>

<template>
  <div class="sheet-backdrop" data-sheet-backdrop @click.self="emit('close')">
    <section class="sheet reel-sheet" role="dialog" aria-modal="true" :aria-label="`${REEL_LABELS[reel]} öffnen`" :data-open-reel="reel">
      <header class="sheet-head">
        <span class="sheet-symbol"><SymbolIcon :family="variant.family" /></span>
        <div>
          <p class="sheet-kicker">{{ REEL_LABELS[reel] }} · {{ FAMILY_INFO[variant.family].symbol }}, {{ FAMILY_INFO[variant.family].label }}</p>
          <h2 data-variant-name>{{ variant.name }}</h2>
        </div>
        <button type="button" class="close" aria-label="Schließen" @click="emit('close')">✕</button>
      </header>

      <div class="sheet-row">
        <span class="row-label">Klang</span>
        <button type="button" class="round" aria-label="Voriger Klang" @click="cycle(-1)">‹</button>
        <strong class="row-value" data-sound>{{ SOUND_LABELS[sound as keyof typeof SOUND_LABELS] ?? sound }}</strong>
        <button type="button" class="round" aria-label="Nächster Klang" data-next-sound @click="cycle(1)">›</button>
      </div>

      <div class="sheet-row">
        <span class="row-label">{{ reel === "beat" ? "Dichte" : "Lage" }}</span>
        <button type="button" class="round" :aria-label="shiftLabels[0]" :disabled="setting.shift <= -1" data-shift-down @click="setShift(-1)">−</button>
        <strong class="row-value" data-shift>{{ shiftLabels[setting.shift + 1] }}</strong>
        <button type="button" class="round" :aria-label="shiftLabels[2]" :disabled="setting.shift >= 1" data-shift-up @click="setShift(1)">+</button>
      </div>

      <div class="sheet-actions">
        <button
          type="button"
          class="candy-button"
          data-solo
          @touchstart.prevent="emit('solo', true)"
          @touchend.prevent="emit('solo', false)"
          @touchcancel="emit('solo', false)"
          @mousedown="emit('solo', true)"
          @mouseup="emit('solo', false)"
          @mouseleave="emit('solo', false)"
        >
          Solo hören <small>(halten)</small>
        </button>
        <button type="button" class="candy-button spin" :disabled="locked" data-spin-one @click="emit('spin')">Nur diese Walze drehen</button>
      </div>
    </section>
  </div>
</template>
