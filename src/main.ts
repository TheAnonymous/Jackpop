import { createApp } from "vue";
import App from "./App.vue";
import { setUpApp } from "./pwa";
import "./styles.css";

createApp(App).mount("#app");
setUpApp();

// Offline renders and rigged pulls for the automated tests; only on this machine and only on request.
const testRequested = new URLSearchParams(window.location.search).get("audio-test") === "1";
const localHost = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(window.location.hostname);
if (testRequested && localHost) void import("./test-api").then(({ installTestApi }) => installTestApi());
