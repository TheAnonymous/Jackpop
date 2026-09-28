<script setup lang="ts">
import { computed } from "vue";

/** The coin slot: hold it and sing, let go and your voice drops into the song. */
export type CoinState = "idle" | "arming" | "recording" | "tuning";

const props = defineProps<{ state: CoinState; hasVoice: boolean; muted: boolean; level: number; progress: number; locked: boolean }>();
const emit = defineEmits<{ press: []; release: []; mute: []; remove: [] }>();

const label = computed(() => {
  switch (props.state) {
    case "arming": return "Mikrofon geht auf …";
    case "recording": return "Sing!";
    case "tuning": return "Stimme fällt rein …";
    default: return props.hasVoice ? "Neue Stimme: halten und singen" : "Münzschlitz: halten und singen";
  }
});

let holding = false;

function down(event: PointerEvent): void {
  if (props.locked) return;
  try {
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  } catch {
    return;
  }
  holding = true;
  emit("press");
}

function up(): void {
  if (!holding) return;
  holding = false;
  emit("release");
}

function key(event: KeyboardEvent, pressed: boolean): void {
  if (event.key !== " " && event.key !== "Enter") return;
  event.preventDefault();
  if (event.repeat) return;
  if (pressed && !holding && !props.locked) {
    holding = true;
    emit("press");
  } else if (!pressed) {
    up();
  }
}
</script>

<template>
  <section class="coin" :class="state" aria-label="Münzschlitz">
    <button
      type="button"
      class="coin-slot"
      :aria-pressed="state === 'recording'"
      :aria-disabled="locked"
      aria-label="Münzschlitz: gedrückt halten und singen"
      data-coin-slot
      :data-state="state"
      :style="{ '--level': level, '--progress': progress }"
      @touchstart.prevent
      @contextmenu.prevent
      @pointerdown="down"
      @pointerup="up"
      @pointercancel="up"
      @keydown="key($event, true)"
      @keyup="key($event, false)"
    >
      <span class="coin-hole" aria-hidden="true"><span class="coin-glow"></span></span>
      <span class="coin-label">{{ label }}</span>
      <span class="coin-progress" aria-hidden="true"></span>
    </button>
    <template v-if="hasVoice">
      <button type="button" class="coin-mini" :aria-pressed="!muted" :aria-label="muted ? 'Stimme einschalten' : 'Stimme stummschalten'" data-voice-mute @click="emit('mute')">
        {{ muted ? "aus" : "an" }}
      </button>
      <button type="button" class="coin-mini" aria-label="Stimme entfernen" data-voice-remove @click="emit('remove')">✕</button>
    </template>
  </section>
</template>
