import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";
import vue from "@vitejs/plugin-vue";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

// The production Content-Security-Policy of musik.jodie-oesterling.de
// (server-infra hosts/rs2000/site-values.nix), so the E2E tests against the
// preview catch anything the live site would block.
const PRODUCTION_CSP =
  "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'; script-src 'self' blob:; style-src 'self' 'unsafe-inline'; connect-src 'self' https://api.open-meteo.com; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' blob: data:; worker-src 'self' blob:; manifest-src 'self'";

/**
 * Emits sw.js from sw-template.js with the list of files a phone keeps for
 * offline starts: the page, every bundle and worker and the public files
 * (not the test-only hook). The version changes with any of them, so an
 * installed app notices each release.
 */
function serviceWorker(): Plugin {
  return {
    name: "jackpop-service-worker",
    apply: "build",
    generateBundle(_options, bundle) {
      const publicFiles = readdirSync("public").sort();
      const bundled = Object.keys(bundle).filter((file) => file !== "index.html" && !file.endsWith(".map") && !file.includes("test-api")).sort();
      const files = ["./", ...publicFiles, ...bundled];
      const template = readFileSync("sw-template.js", "utf8");
      const hash = createHash("sha256").update(template).update(files.join("\n"));
      for (const file of publicFiles) hash.update(readFileSync(`public/${file}`));
      const source = template.replace("__VERSION__", hash.digest("hex").slice(0, 12)).replace("__PRECACHE__", JSON.stringify(files));
      this.emitFile({ type: "asset", fileName: "sw.js", source });
    },
  };
}

export default defineConfig({
  base: "/Jackpop/",
  plugins: [vue(), serviceWorker()],
  // Permissions-Policy as musik.jodie-oesterling.de sends it (microphone for the coin slot, location for a sibling app).
  preview: { headers: { "Content-Security-Policy": PRODUCTION_CSP, "Permissions-Policy": "camera=(), microphone=(self), geolocation=(self)" } },
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  build: { target: "es2022" },
  test: {
    environment: "happy-dom",
    include: ["tests/**/*.test.ts"],
    restoreMocks: true,
  },
});
