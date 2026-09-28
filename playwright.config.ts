import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

const port = Number.parseInt(process.env.JACKPOP_E2E_PORT ?? "4304", 10);

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: "list",
  use: {
    baseURL: `http://127.0.0.1:${port}/Jackpop/`,
    trace: "on-first-retry",
  },
  webServer: {
    command: `npm run preview -- --host 127.0.0.1 --port ${port} --strictPort`,
    port,
    reuseExistingServer: false,
  },
  // Jackpop is made for Android phones: Chrome on Android is Chromium, emulated
  // here with touch, a phone viewport and a mobile user agent. The microphone
  // is a recorded "aah" (scripts/make-voice-fixture.mjs), already allowed.
  projects: [{
    name: "android",
    use: {
      ...devices["Pixel 7"],
      permissions: ["microphone"],
      launchOptions: {
        args: [
          "--use-fake-ui-for-media-stream",
          "--use-fake-device-for-media-stream",
          `--use-file-for-fake-audio-capture=${fileURLToPath(new URL("./e2e/fixtures/voice.wav", import.meta.url))}`,
        ],
      },
    },
  }],
});
