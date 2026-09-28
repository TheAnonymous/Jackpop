import { shallowRef } from "vue";

/** Chrome's install offer, kept for the "Als App installieren" entry in the help. */
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/** A new version is downloaded and waits for a reload. */
export const updateReady = shallowRef(false);
/** Chrome offers installing the app (not yet installed, criteria met). */
export const installable = shallowRef(false);
/** Whether Chrome promised to keep the line and the voice takes even when the phone runs low on space. */
export const storagePersisted = shallowRef<boolean | null>(null);

let installPrompt: InstallPromptEvent | null = null;
let waiting: ServiceWorker | null = null;
let reloading = false;

/**
 * Registers the service worker that keeps Jackpop on the phone for offline
 * starts, and watches for new versions. Only in built releases: the dev
 * server's modules change all the time.
 */
export function setUpApp(): void {
  void keepStorage();
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installPrompt = event as InstallPromptEvent;
    installable.value = true;
  });
  window.addEventListener("appinstalled", () => {
    installPrompt = null;
    installable.value = false;
    // Installed apps get lasting storage; ask again now.
    void keepStorage();
  });
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    // Only the version the user asked for reloads the page, not the first install.
    if (reloading) window.location.reload();
  });
  void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL }).then((registration) => {
    const offer = (worker: ServiceWorker | null) => {
      if (!worker || !navigator.serviceWorker.controller) return;
      waiting = worker;
      updateReady.value = true;
    };
    if (registration.waiting) offer(registration.waiting);
    registration.addEventListener("updatefound", () => {
      const worker = registration.installing;
      worker?.addEventListener("statechange", () => {
        if (worker.state === "installed") offer(worker);
      });
    });
  }).catch((error: unknown) => console.warn("Service Worker nicht registriert", error));
}

/** Switches to the waiting version; the page reloads once it takes over. */
export function applyUpdate(): void {
  if (!waiting) return;
  reloading = true;
  waiting.postMessage("skip-waiting");
}

export async function install(): Promise<void> {
  const prompt = installPrompt;
  if (!prompt) return;
  installPrompt = null;
  installable.value = false;
  await prompt.prompt();
}

/**
 * Asks Chrome to keep this site's storage (the line, the stats and the voice
 * takes) instead of clearing it when space runs low. Chrome decides
 * silently: installed apps and sites used often get it.
 */
export async function keepStorage(): Promise<void> {
  const storage = navigator.storage;
  if (typeof storage?.persist !== "function") return;
  try {
    storagePersisted.value = (await storage.persisted()) || (await storage.persist());
  } catch {
    storagePersisted.value = false;
  }
}
