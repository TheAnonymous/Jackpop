<script setup lang="ts">
import { computed } from "vue";

/** A big candy dial: drag up or down to turn it, or use the arrow keys. */
const props = defineProps<{ value: number; label: string; hint: string; color: string; name: string }>();
const emit = defineEmits<{ change: [value: number] }>();

const PIXELS_FOR_FULL_TURN = 180;
let drag: { id: number; y: number; start: number } | null = null;
const angle = computed(() => -135 + props.value * 270);

function clamp(value: number): number {
  return Math.round(Math.max(0, Math.min(1, value)) * 100) / 100;
}

function down(event: PointerEvent): void {
  try {
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  } catch {
    return;
  }
  drag = { id: event.pointerId, y: event.clientY, start: props.value };
}

function move(event: PointerEvent): void {
  if (!drag || event.pointerId !== drag.id) return;
  const value = clamp(drag.start + (drag.y - event.clientY) / PIXELS_FOR_FULL_TURN);
  if (value === props.value) return;
  if (Math.floor(value * 10) !== Math.floor(props.value * 10)) navigator.vibrate?.(4);
  emit("change", value);
}

function end(event: PointerEvent): void {
  if (drag?.id === event.pointerId) drag = null;
}

function key(event: KeyboardEvent): void {
  const delta = { ArrowUp: 0.05, ArrowRight: 0.05, ArrowDown: -0.05, ArrowLeft: -0.05 }[event.key];
  if (delta === undefined) return;
  event.preventDefault();
  emit("change", clamp(props.value + delta));
}
</script>

<template>
  <div class="candy">
    <div
      class="candy-dial"
      role="slider"
      tabindex="0"
      :aria-label="`${label}: ${hint}`"
      aria-valuemin="0"
      aria-valuemax="100"
      :aria-valuenow="Math.round(value * 100)"
      :data-knob="name"
      :style="{ '--color': color, '--angle': `${angle}deg`, '--fill': `${value * 270}deg` }"
      @touchstart.prevent
      @pointerdown="down"
      @pointermove="move"
      @pointerup="end"
      @pointercancel="end"
      @keydown="key"
    >
      <span class="candy-swirl" aria-hidden="true"></span>
      <span class="candy-dot" aria-hidden="true"></span>
    </div>
    <span class="candy-label">{{ label }}</span>
  </div>
</template>
