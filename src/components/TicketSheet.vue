<script setup lang="ts">
import { computed } from "vue";
import type { Family } from "../music/reels";
import SymbolIcon from "./SymbolIcon.vue";

/** The printed ticket: the song to listen to, share or save, and the recipe link. */
const props = defineProps<{
  state: "printing" | "ready";
  progress: number;
  title: string;
  families: Family[];
  seconds: number;
  tempo: number;
  voice: boolean;
  url: string | null;
  format: "ogg" | "wav" | null;
}>();
const emit = defineEmits<{ share: []; recipe: []; save: []; close: [] }>();

const length = computed(() => {
  const total = Math.round(props.seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
});
</script>

<template>
  <div class="sheet-backdrop" data-sheet-backdrop @click.self="state === 'ready' && emit('close')">
    <section class="sheet ticket-sheet" role="dialog" aria-modal="true" aria-label="Dein Ticket" data-ticket-sheet :data-state="state">
      <div class="ticket" :class="{ printing: state === 'printing' }">
        <p class="ticket-brand">Jackpop · Hit-Ticket</p>
        <h2 class="ticket-title" data-ticket-title>{{ title }}</h2>
        <div class="ticket-line" aria-hidden="true">
          <span v-for="(family, index) in families" :key="index" class="ticket-symbol"><SymbolIcon :family="family" /></span>
        </div>
        <p class="ticket-meta">{{ length }} · {{ tempo }} BPM · {{ voice ? "mit deiner Stimme" : "ohne Stimme" }}</p>
        <template v-if="state === 'printing'">
          <div class="ticket-progress" role="progressbar" :aria-valuenow="Math.round(progress * 100)" aria-valuemin="0" aria-valuemax="100" aria-label="Druckt">
            <span :style="{ width: `${Math.round(progress * 100)}%` }"></span>
          </div>
          <p class="ticket-status">Druckt … {{ Math.round(progress * 100) }} %</p>
        </template>
      </div>

      <template v-if="state === 'ready'">
        <audio v-if="url" class="ticket-audio" :src="url" controls preload="auto" data-ticket-audio></audio>
        <div class="sheet-actions">
          <button type="button" class="candy-button primary" data-ticket-share @click="emit('share')">Song teilen</button>
          <button type="button" class="candy-button" data-ticket-recipe @click="emit('recipe')">Rezept-Link<small>ohne Stimme</small></button>
        </div>
        <div class="ticket-footer">
          <button type="button" class="text-button" data-ticket-save @click="emit('save')">Als Datei speichern ({{ format === "ogg" ? "Ogg" : "WAV" }})</button>
          <button type="button" class="text-button" data-ticket-close @click="emit('close')">Schließen</button>
        </div>
      </template>
    </section>
  </div>
</template>
