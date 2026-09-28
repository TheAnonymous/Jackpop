<script setup lang="ts">
import type { Mood } from "../machine/machine";

/** The machine's face in the middle of its lights: happy, impatient, boiling. */
defineProps<{ mood: Mood }>();

const LABELS: Record<Mood, string> = { happy: "fröhlich", impatient: "ungeduldig", hot: "kocht" };
</script>

<template>
  <span class="mood-face" :class="mood" role="img" :aria-label="`Laune: ${LABELS[mood]}`" :data-mood="mood">
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="17" r="12" class="mood-head" stroke="#3a1147" stroke-width="2" />
      <template v-if="mood === 'happy'">
        <circle cx="12" cy="15" r="1.8" fill="#3a1147" />
        <circle cx="20" cy="15" r="1.8" fill="#3a1147" />
        <path d="M10.5 19.5q5.5 5 11 0" fill="none" stroke="#3a1147" stroke-width="2" stroke-linecap="round" />
      </template>
      <template v-else-if="mood === 'impatient'">
        <path d="M9.5 12.5l4.5 1.2M22.5 12.5 18 13.7" stroke="#3a1147" stroke-width="2" stroke-linecap="round" />
        <circle cx="13" cy="16" r="1.6" fill="#3a1147" />
        <circle cx="21" cy="16" r="1.6" fill="#3a1147" />
        <path d="M11.5 22h9" stroke="#3a1147" stroke-width="2" stroke-linecap="round" />
      </template>
      <template v-else>
        <path d="M9 11.5l5 2.5M23 11.5l-5 2.5" stroke="#3a1147" stroke-width="2.2" stroke-linecap="round" />
        <circle cx="12.5" cy="16.5" r="1.7" fill="#3a1147" />
        <circle cx="19.5" cy="16.5" r="1.7" fill="#3a1147" />
        <ellipse cx="16" cy="22.5" rx="3.2" ry="2.3" fill="#3a1147" />
        <path class="steam" d="M6 6q-2-2 0-4M26 6q2-2 0-4" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" />
      </template>
    </svg>
  </span>
</template>
