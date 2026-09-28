<script setup lang="ts">
import { onBeforeUnmount, ref } from "vue";

/** Jackpot confetti on a canvas over everything; it never catches a tap. */
const canvas = ref<HTMLCanvasElement | null>(null);
interface Piece { x: number; y: number; vx: number; vy: number; spin: number; angle: number; size: number; color: string; round: boolean }
let pieces: Piece[] = [];
let frame = 0;
let last = 0;

function burst(colors: string[], amount = 140): void {
  const element = canvas.value;
  if (!element) return;
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  element.width = element.clientWidth * ratio;
  element.height = element.clientHeight * ratio;
  const width = element.clientWidth;
  for (let index = 0; index < amount; index += 1) {
    const fromLeft = index % 2 === 0;
    pieces.push({
      x: fromLeft ? width * 0.15 : width * 0.85,
      y: element.clientHeight * 0.45,
      vx: (fromLeft ? 1 : -1) * (80 + Math.random() * 260),
      vy: -(380 + Math.random() * 420),
      spin: (Math.random() - 0.5) * 14,
      angle: Math.random() * Math.PI,
      size: 6 + Math.random() * 7,
      color: colors[index % colors.length] ?? "#ffffff",
      round: Math.random() < 0.3,
    });
  }
  if (!frame) {
    last = performance.now();
    frame = requestAnimationFrame(draw);
  }
}

function draw(now: number): void {
  const element = canvas.value;
  const context = element?.getContext("2d");
  if (!element || !context) return;
  const seconds = Math.min(0.05, (now - last) / 1000);
  last = now;
  const ratio = element.width / Math.max(1, element.clientWidth);
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, element.clientWidth, element.clientHeight);
  for (const piece of pieces) {
    piece.vy += 900 * seconds;
    piece.vx *= 0.99;
    piece.x += piece.vx * seconds;
    piece.y += piece.vy * seconds;
    piece.angle += piece.spin * seconds;
    context.save();
    context.translate(piece.x, piece.y);
    context.rotate(piece.angle);
    context.fillStyle = piece.color;
    if (piece.round) {
      context.beginPath();
      context.arc(0, 0, piece.size / 2.4, 0, Math.PI * 2);
      context.fill();
    } else {
      context.fillRect(-piece.size / 2, -piece.size / 4, piece.size, piece.size / 2);
    }
    context.restore();
  }
  pieces = pieces.filter((piece) => piece.y < element.clientHeight + 40);
  frame = pieces.length > 0 ? requestAnimationFrame(draw) : 0;
  if (!frame) context.clearRect(0, 0, element.clientWidth, element.clientHeight);
}

onBeforeUnmount(() => cancelAnimationFrame(frame));
defineExpose({ burst });
</script>

<template>
  <canvas ref="canvas" class="confetti" aria-hidden="true"></canvas>
</template>
