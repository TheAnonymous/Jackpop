<script setup lang="ts">
import { computed } from "vue";
import type { ReelId } from "../music/reels";
import { FAMILY_INFO, REEL_LABELS, variantAt } from "../music/reels";
import SymbolIcon from "./SymbolIcon.vue";

const props = defineProps<{
  reel: ReelId;
  /** Strip position under the payline; fractions while the reel moves. */
  position: number;
  spinning: boolean;
  held: boolean;
}>();
defineEmits<{ open: [] }>();

const base = computed(() => Math.floor(props.position));
const fraction = computed(() => props.position - base.value);
/** Five symbols: two above, the one on the line, two below. Higher strip positions sit above. */
const slots = computed(() => [-2, -1, 0, 1, 2].map((offset) => {
  const index = base.value + offset;
  return { key: index, family: variantAt(props.reel, index).family, y: (fraction.value - offset) * 100 };
}));
const current = computed(() => variantAt(props.reel, Math.round(props.position)));
</script>

<template>
  <button
    type="button"
    class="reel"
    :class="{ spinning, held }"
    :data-reel="reel"
    :data-family="current.family"
    :aria-label="`${REEL_LABELS[reel]}: ${FAMILY_INFO[current.family].symbol}, ${current.name}. Antippen zum Öffnen`"
    @click="$emit('open')"
  >
    <span v-for="slot in slots" :key="slot.key" class="reel-slot" :style="{ transform: `translateY(${slot.y}%)` }">
      <SymbolIcon :family="slot.family" />
    </span>
  </button>
</template>
