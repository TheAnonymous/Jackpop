// Draws Jackpop's app icons (the slot machine from favicon.svg) as PNGs with
// Playwright's Chromium: `node scripts/make-icons.mjs`. The maskable icon
// keeps the machine inside the safe circle, since launchers crop it.
import { writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";

const MACHINE = `
  <rect x="8" y="14" width="40" height="36" rx="8" fill="#ff5fa8" stroke="#3a1147" stroke-width="2.5"/>
  <rect x="13" y="22" width="30" height="20" rx="4" fill="#fff6fb"/>
  <path d="M28 38.5s-6-3.7-7.7-7.4c-1.1-2.6.6-5.5 3.5-5.5 1.6 0 2.7.9 4.2 2.6 1.5-1.7 2.6-2.6 4.2-2.6 2.9 0 4.6 2.9 3.5 5.5-1.7 3.7-7.7 7.4-7.7 7.4z" fill="#ff4fa3" stroke="#3a1147" stroke-width="1.2"/>
  <rect x="51" y="20" width="4" height="22" rx="2" fill="#ffe3f1"/>
  <circle cx="53" cy="17" r="5" fill="#ffd23f" stroke="#3a1147" stroke-width="1.5"/>`;
/** The machine's middle, to scale it around. */
const CENTER = { x: 32.4, y: 31.6 };

function icon(scale, rounded) {
  const move = `translate(32 32) scale(${scale}) translate(${-CENTER.x} ${-CENTER.y})`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs><radialGradient id="glow" cx="50%" cy="45%" r="60%"><stop offset="0" stop-color="#6a2090"/><stop offset="1" stop-color="#2b0b3f"/></radialGradient></defs>
  <rect width="64" height="64" rx="${rounded ? 14 : 0}" fill="url(#glow)"/>
  <g transform="${move}">${MACHINE}</g>
</svg>`;
}

const ICONS = [
  { file: "public/icon-192.png", size: 192, svg: icon(1.02, true) },
  { file: "public/icon-512.png", size: 512, svg: icon(1.02, true) },
  { file: "public/icon-maskable-512.png", size: 512, svg: icon(0.74, false) },
  { file: "public/apple-touch-icon.png", size: 180, svg: icon(0.9, false) },
];

const browser = await chromium.launch();
const page = await browser.newPage();
for (const { file, size, svg } of ICONS) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
  writeFileSync(file, await page.screenshot({ omitBackground: true }));
  console.log(`${file}: ${size}×${size}`);
}
await browser.close();
