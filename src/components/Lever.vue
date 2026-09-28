<script setup lang="ts">
import { ref } from "vue";

/**
 * The one-armed bandit's arm. Drag the ball down: it clicks through a ratchet
 * on the way, and letting go past a third of the way pulls. A full pull
 * spins the reels a bar longer.
 */
const props = defineProps<{ locked: boolean }>();
const emit = defineEmits<{ pull: [strength: number]; ratchet: [depth: number]; grab: [] }>();

const NOTCHES = 8;
const depth = ref(0);
const dragging = ref(false);
const root = ref<HTMLElement | null>(null);
let drag: { id: number; y: number; travel: number; notch: number } | null = null;

function down(event: PointerEvent): void {
  if (props.locked) return;
  try {
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  } catch {
    return;
  }
  const height = root.value?.getBoundingClientRect().height ?? 240;
  drag = { id: event.pointerId, y: event.clientY, travel: Math.max(80, height * 0.62), notch: 0 };
  dragging.value = true;
  emit("grab");
}

function move(event: PointerEvent): void {
  if (!drag || event.pointerId !== drag.id) return;
  depth.value = Math.max(0, Math.min(1, (event.clientY - drag.y) / drag.travel));
  const notch = Math.floor(depth.value * NOTCHES);
  if (notch > drag.notch) {
    emit("ratchet", depth.value);
    navigator.vibrate?.(6);
  }
  drag.notch = notch;
}

function end(event: PointerEvent): void {
  if (!drag || event.pointerId !== drag.id) return;
  const strength = depth.value;
  drag = null;
  dragging.value = false;
  depth.value = 0;
  if (strength >= 0.3) {
    navigator.vibrate?.(25);
    emit("pull", strength);
  }
}

function key(event: KeyboardEvent): void {
  if (props.locked) return;
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    emit("pull", 0.6);
  } else if (event.key === "ArrowDown") {
    event.preventDefault();
    emit("pull", 1);
  }
}
</script>

<template>
  <div
    ref="root"
    class="lever"
    :class="{ dragging, locked }"
    role="button"
    tabindex="0"
    aria-label="Hebel ziehen"
    :aria-disabled="locked"
    :style="{ '--depth': depth }"
    data-lever
    @touchstart.prevent
    @pointerdown="down"
    @pointermove="move"
    @pointerup="end"
    @pointercancel="end"
    @keydown="key"
  >
    <span class="lever-slot" aria-hidden="true"></span>
    <span class="lever-rod" aria-hidden="true"></span>
    <span class="lever-ball" aria-hidden="true"></span>
    <span class="lever-hub" aria-hidden="true"></span>
  </div>
</template>
