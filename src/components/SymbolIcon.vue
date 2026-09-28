<script setup lang="ts">
import type { Family } from "../music/reels";
import { FAMILY_INFO } from "../music/reels";

defineProps<{ family: Family }>();

const PATHS: Record<Family, string> = {
  sweet: "M12 21.2s-7.6-4.7-9.7-9.3C.9 8.5 3 4.8 6.7 4.8c2 0 3.4 1.1 5.3 3.2 1.9-2.1 3.3-3.2 5.3-3.2 3.7 0 5.8 3.7 4.4 7.1-2.1 4.6-9.7 9.3-9.7 9.3z",
  sparkle: "M12 2.2l2.9 6.2 6.8.8-5 4.6 1.4 6.7L12 17.1l-6.1 3.4 1.4-6.7-5-4.6 6.8-.8z",
  wild: "M13.8 1.8 4.6 13.6h6.2L9.3 22.2l10.1-12.8h-6.3z",
  dreamy: "M20.2 15.2A8.8 8.8 0 0 1 8.8 3.8a8.9 8.9 0 1 0 11.4 11.4z",
  club: "M12 22.2c-4.2 0-7.3-2.9-7.3-6.9 0-3.4 2.4-5.6 3.9-7.9.9 1.6 1.9 2.6 3 3C11.6 7.2 12.8 4.4 14.9 2c.6 3.5 4.5 6.5 4.5 11.4 0 5.4-2.9 8.8-7.4 8.8z",
  anthem: "M2.6 7.6 7.4 11.8 12 4.4l4.6 7.4 4.8-4.2-2.1 12H4.7z",
  rare: "M6.2 3.4h11.6l3.8 5.8L12 21.2 2.4 9.2z",
};
</script>

<template>
  <svg class="symbol" viewBox="0 0 24 24" :aria-label="FAMILY_INFO[family].symbol" role="img">
    <path :d="PATHS[family]" :fill="FAMILY_INFO[family].color" stroke="#3a1147" stroke-width="1.2" stroke-linejoin="round" />
    <path v-if="family === 'rare'" d="M2.4 9.2h19.2M9.2 3.4 7.6 9.2 12 21.2l4.4-12-1.6-5.8" fill="none" stroke="#3a1147" stroke-width="0.9" stroke-linejoin="round" />
    <ellipse cx="9" cy="9" rx="2.4" ry="1.4" fill="#fff" opacity="0.55" transform="rotate(-30 9 9)" />
  </svg>
</template>
