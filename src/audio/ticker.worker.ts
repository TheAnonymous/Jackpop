// A steady heartbeat for the scheduler. Timers in a worker keep running when
// the page's own timers are throttled, so the music does not stumble.
let timer: ReturnType<typeof setInterval> | null = null;

self.onmessage = (event: MessageEvent<"start" | "stop">) => {
  if (timer !== null) clearInterval(timer);
  timer = event.data === "start" ? setInterval(() => self.postMessage(0), 25) : null;
};
