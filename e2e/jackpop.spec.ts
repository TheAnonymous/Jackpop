import { devices, expect, test, type Page } from "@playwright/test";

const port = Number.parseInt(process.env.JACKPOP_E2E_PORT ?? "4304", 10);
const REELS = ["beat", "chords", "hook", "bass"] as const;

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.stack ?? error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("requestfailed", (request) => errors.push(`Request fehlgeschlagen: ${request.url()}`));
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.protocol.startsWith("http") && url.origin !== `http://127.0.0.1:${port}`) errors.push(`Externer Request: ${request.url()}`);
  });
  return errors;
}

async function open(page: Page, query = ""): Promise<void> {
  await page.goto(`./${query}`);
  await page.locator("[data-help-close]").tap();
  await expect(page.locator(".help")).toHaveCount(0);
}

/** A real finger drag through Chrome's touch pipeline; the finger rests before lifting, as when pulling a lever. */
async function drag(page: Page, x: number, y: number, dx: number, dy: number): Promise<void> {
  const client = await page.context().newCDPSession(page);
  await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  for (let step = 1; step <= 10; step += 1) {
    await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x + (dx * step) / 10, y: y + (dy * step) / 10 }] });
    await page.waitForTimeout(16);
  }
  await page.waitForTimeout(120);
  await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await client.detach();
}

async function pullLever(page: Page, distance = 170): Promise<void> {
  const ball = (await page.locator(".lever-ball").boundingBox())!;
  await drag(page, ball.x + ball.width / 2, ball.y + ball.height / 2, 0, distance);
}

const families = (page: Page) => page.locator(".reel").evaluateAll((reels) => reels.map((reel) => (reel as HTMLElement).dataset.family));

async function waitForRest(page: Page): Promise<void> {
  await expect(page.locator(".reel.spinning")).toHaveCount(0, { timeout: 10_000 });
  await expect(page.locator("[data-lever]")).toHaveAttribute("aria-disabled", "false", { timeout: 10_000 });
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "vibrate", { value: () => true, configurable: true });
  });
});

test("fits a Pixel 7 without scrolling, with big thumb targets and the help only once", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("./");
  await expect(page.locator(".help")).toBeVisible();
  await page.locator("[data-help-close]").tap();

  const viewport = page.viewportSize()!;
  const size = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight }));
  expect(size.width).toBeLessThanOrEqual(viewport.width);
  expect(size.height).toBeLessThanOrEqual(viewport.height);
  for (const selector of [".cabinet", "[data-lever]", ".candies"]) {
    const box = (await page.locator(selector).boundingBox())!;
    expect(box.y, selector).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height, selector).toBeLessThanOrEqual(viewport.height);
  }
  for (const control of await page.locator(".hold, .candy-dial, [data-play]").all()) {
    const box = (await control.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(40);
  }
  expect((await page.locator(".reel").first().boundingBox())!.height).toBeGreaterThanOrEqual(200);
  const reel = (await page.locator(".reel").first().boundingBox())!;
  const symbol = (await page.locator(".reel .symbol").nth(2).boundingBox())!;
  expect(symbol.width, "die Symbole füllen die Walze").toBeGreaterThan(reel.width * 0.5);
  await expect(page.locator(".lever-hint")).toBeVisible();
  expect(await families(page)).toEqual(["club", "sweet", "sweet", "sweet"]);
  expect(errors).toEqual([]);

  await page.reload();
  await expect(page.locator(".cabinet")).toBeVisible();
  await expect(page.locator(".help")).toHaveCount(0);
});

test("pulling the lever spins the reels, starts the music on one audio context and counts the pull", async ({ page }) => {
  const errors = watchErrors(page);
  await page.addInitScript(() => {
    const Native = window.AudioContext;
    const created: { hint: string; context: AudioContext }[] = [];
    (window as unknown as { audioContexts: typeof created }).audioContexts = created;
    window.AudioContext = class extends Native {
      constructor(options?: AudioContextOptions) {
        super(options);
        created.push({ hint: String(options?.latencyHint ?? "default"), context: this });
      }
    };
  });
  await open(page, "?audio-test=1");
  await page.evaluate(() => window.__jackpopTest!.forceNextSpin({ beat: 1, chords: 2, hook: 3, bass: 4 }));
  await pullLever(page);

  await expect(page.locator("[data-play]")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".reel.spinning").first()).toBeVisible();
  await expect(page.locator("[data-lever]")).toHaveAttribute("aria-disabled", "true");
  await waitForRest(page);
  expect(await families(page)).toEqual(["wild", "sparkle", "wild", "club"]);
  await expect(page.locator("[data-stats]")).toContainText("1 Zug");
  await expect(page.locator(".lever-hint")).toHaveCount(0);
  const contexts = await page.evaluate(() => (window as unknown as { audioContexts: { hint: string; context: AudioContext }[] }).audioContexts
    .map(({ hint, context }) => `${hint}:${context.state}`));
  expect(contexts).toEqual(["balanced:running"]);

  await page.reload();
  await expect.poll(() => families(page)).toEqual(["wild", "sparkle", "wild", "club"]);
  expect(errors).toEqual([]);
});

test("four hearts are a mega jackpot with banner, lights and confetti", async ({ page }) => {
  const errors = watchErrors(page);
  await open(page, "?audio-test=1");
  await page.evaluate(() => window.__jackpopTest!.forceNextSpin({ beat: 0, chords: 0, hook: 0, bass: 0 }));
  await pullLever(page);
  await expect(page.locator("[data-banner]")).toHaveText("4 × Herz: Mega-Jackpot!", { timeout: 10_000 });
  await expect(page.locator("[data-banner]")).toHaveClass(/big/);
  const bulbs = await page.locator(".bulb.on").count();
  expect(bulbs).toBeGreaterThanOrEqual(6);
  const painted = await page.locator(".confetti").evaluate((canvas: HTMLCanvasElement) => {
    const context = canvas.getContext("2d")!;
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let count = 0;
    for (let index = 3; index < data.length; index += 16) if (data[index]! > 0) count += 1;
    return count;
  });
  expect(painted, "Konfetti ist sichtbar").toBeGreaterThan(50);
  await expect(page.locator("[data-stats]")).toContainText("1");
  expect(errors).toEqual([]);
});

test("a held reel keeps its symbol through a pull, and undo brings the old line back", async ({ page }) => {
  await open(page, "?audio-test=1");
  await page.locator('[data-hold="beat"]').tap();
  await expect(page.locator('[data-hold="beat"]')).toHaveAttribute("aria-pressed", "true");
  await page.evaluate(() => window.__jackpopTest!.forceNextSpin({ beat: 5, chords: 5, hook: 5, bass: 5 }));
  await pullLever(page);
  await waitForRest(page);
  const after = await families(page);
  expect(after[0]).toBe("club");
  expect(after.slice(1)).not.toEqual(["sweet", "sweet", "sweet"]);

  await page.locator("[data-undo]").tap();
  await expect.poll(() => families(page)).toEqual(["club", "sweet", "sweet", "sweet"]);
});

test("nudging steps a reel through its symbols and plays nothing wrong", async ({ page }) => {
  const errors = watchErrors(page);
  await open(page);
  const hook = page.locator('.reel[data-reel="hook"]');
  await expect(hook).toHaveAttribute("data-family", "sweet");
  await page.locator('[data-nudge-down="hook"]').tap();
  await expect(hook).toHaveAttribute("data-family", "sparkle");
  await page.locator('[data-nudge-up="hook"]').tap();
  await page.locator('[data-nudge-up="hook"]').tap();
  await expect(hook).toHaveAttribute("data-family", "club");
  await page.reload();
  await expect(page.locator('.reel[data-reel="hook"]')).toHaveAttribute("data-family", "club");
  expect(errors).toEqual([]);
});

test("an opened symbol changes its sound and register and spins on its own", async ({ page }) => {
  const errors = watchErrors(page);
  await open(page);
  await page.locator('.reel[data-reel="hook"]').tap();
  const sheet = page.locator('[data-open-reel="hook"]');
  await expect(sheet).toBeVisible();
  await expect(sheet.locator("[data-variant-name]")).toHaveText("Kaugummi-Hook");
  await expect(sheet.locator("[data-sound]")).toHaveText("Chip");
  await sheet.locator("[data-next-sound]").tap();
  await expect(sheet.locator("[data-sound]")).toHaveText("Glocke");
  await sheet.locator("[data-shift-up]").tap();
  await expect(sheet.locator("[data-shift]")).toHaveText("höher");
  await expect(sheet.locator("[data-shift-up]")).toBeDisabled();

  await sheet.locator("[data-spin-one]").tap();
  await expect(sheet).toHaveCount(0);
  await expect(page.locator("[data-play]")).toHaveAttribute("aria-pressed", "true");
  await waitForRest(page);
  await expect(page.locator('.reel[data-reel="hook"]'), "ein anderes Symbol, auch wenn es wieder ein Herz sein kann").not.toHaveAttribute("aria-label", /Kaugummi-Hook/);
  await expect.poll(() => families(page).then((all) => [all[0], all[1], all[3]])).toEqual(["club", "sweet", "sweet"]);

  await page.locator('.reel[data-reel="hook"]').tap();
  await expect(page.locator("[data-shift]"), "ein neues Symbol bringt seine eigene Lage mit").toHaveText("normal");
  await page.locator("[data-sheet-backdrop]").click({ position: { x: 20, y: 20 } });
  await expect(page.locator("[data-sheet-backdrop]")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("the candy knobs turn with the thumb and remember their setting", async ({ page }) => {
  await open(page);
  const chaos = page.locator('[data-knob="chaos"]');
  await expect(chaos).toHaveAttribute("aria-valuenow", "20");
  const box = (await chaos.boundingBox())!;
  await drag(page, box.x + box.width / 2, box.y + box.height / 2, 0, -90);
  const value = Number(await chaos.getAttribute("aria-valuenow"));
  expect(value).toBeGreaterThanOrEqual(65);
  await page.reload();
  await expect(page.locator('[data-knob="chaos"]')).toHaveAttribute("aria-valuenow", String(value));
});

/** Holds a finger on an element for `ms`, as a real press. */
async function hold(page: Page, selector: string, ms: number): Promise<void> {
  const box = (await page.locator(selector).boundingBox())!;
  const client = await page.context().newCDPSession(page);
  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
  await page.waitForTimeout(ms);
  await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await client.detach();
}

test("holding the coin slot records the microphone, tunes the voice into the loop and keeps it", async ({ page }) => {
  const errors = watchErrors(page);
  await open(page);
  const coin = page.locator(".coin");
  await expect(page.locator("[data-coin-slot]")).toContainText("Münzschlitz");
  await expect(page.locator("[data-voice-mute]")).toHaveCount(0);

  await hold(page, "[data-coin-slot]", 2_600);
  await expect(page.locator("[data-banner]")).toHaveText("Stimme ist drin!", { timeout: 10_000 });
  await expect(page.locator("[data-coin-slot]")).toHaveAttribute("data-state", "idle");
  await expect(page.locator("[data-play]")).toHaveAttribute("aria-pressed", "true");
  const share = Number(await coin.getAttribute("data-voiced"));
  expect(share, "der gesungene Ton wird erkannt").toBeGreaterThan(0.4);
  await expect(coin, "der Chor wird aus derselben Aufnahme gestimmt").toHaveAttribute("data-choir", "ready");
  await expect(page.locator("[data-voice-mute]")).toHaveAttribute("aria-pressed", "true");

  await page.locator("[data-voice-mute]").tap();
  await expect(page.locator("[data-voice-mute]")).toHaveAttribute("aria-pressed", "false");
  await page.locator("[data-voice-mute]").tap();

  await page.reload();
  await expect(page.locator("[data-voice-mute]")).toBeVisible();
  await page.locator("[data-play]").tap();
  await expect(coin).toHaveAttribute("data-voiced", /^0\.[4-9]|^1$/, { timeout: 10_000 });

  await page.locator("[data-voice-remove]").tap();
  await expect(page.locator("[data-voice-mute]")).toHaveCount(0);
  await page.locator("[data-undo]").tap();
  await expect(page.locator("[data-voice-mute]")).toBeVisible();
  expect(errors).toEqual([]);
});

test("a tap on the coin slot is too short and keeps the old voice", async ({ page }) => {
  await open(page);
  await hold(page, "[data-coin-slot]", 150);
  await expect(page.locator("[data-banner]")).toContainText(/Halt den Schlitz länger|Mikrofon ist bereit/, { timeout: 5_000 });
  await expect(page.locator("[data-voice-mute]")).toHaveCount(0);
});

test.describe("on a 360 px wide phone", () => {
  test.use({ viewport: { width: 360, height: 740 } });

  test("keeps the whole machine on screen", async ({ page }) => {
    await open(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
    for (const control of await page.locator(".topbar button, .hold, .nudge, [data-lever], .candy-dial").all()) {
      const box = (await control.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(360);
      expect(box.y + box.height).toBeLessThanOrEqual(740);
    }
  });
});

test("renders every symbol offline: audible, never clipping, with a lean node count", async ({ page }) => {
  test.setTimeout(180_000);
  const errors = watchErrors(page);
  await page.goto("./?audio-test=1");
  await expect(page.locator("html")).toHaveAttribute("data-audio-test", "ready");

  const mix = await page.evaluate(() => window.__jackpopTest!.render({ seconds: 6.4 }));
  expect(mix.nonFinite).toBe(0);
  expect(mix.peak).toBeLessThanOrEqual(0.99);
  expect(mix.rmsDb).toBeGreaterThan(-20);
  expect(mix.rmsDb).toBeLessThan(-8);
  expect(mix.activeShare).toBeGreaterThan(0.9);
  expect(mix.nodes / mix.seconds, "Audio-Knoten pro Sekunde").toBeLessThan(250);

  for (const knobs of [{ sugar: 1, glitter: 1, chaos: 1 }, { sugar: 0, glitter: 0, chaos: 0 }]) {
    const extreme = await page.evaluate((settings) => window.__jackpopTest!.render({ seconds: 6.4, knobs: settings }), knobs);
    expect(extreme.nonFinite).toBe(0);
    expect(extreme.peak).toBeLessThanOrEqual(0.99);
    expect(extreme.rmsDb).toBeGreaterThan(-22);
  }

  const sung = await page.evaluate(() => window.__jackpopTest!.render({ seconds: 6.4, voice: true, solo: "voice" }));
  expect(sung.nonFinite).toBe(0);
  expect(sung.rmsDb, "die Stimme ist hörbar").toBeGreaterThan(-32);
  const withVoice = await page.evaluate(() => window.__jackpopTest!.render({ seconds: 6.4, voice: true, knobs: { sugar: 1, glitter: 1, chaos: 1 } }));
  expect(withVoice.peak).toBeLessThanOrEqual(0.99);

  const pulled = await page.evaluate(() => window.__jackpopTest!.render({ seconds: 4, pull: 0.5 }));
  expect(pulled.nonFinite).toBe(0);
  expect(pulled.peak).toBeLessThanOrEqual(0.99);

  for (const reel of REELS) {
    const levels = await page.evaluate(async (id) => {
      const results: number[] = [];
      for (let position = 0; position <= 12; position += 1) {
        const metrics = await window.__jackpopTest!.render({ seconds: 3.2, solo: id, positions: { [id]: position } });
        if (metrics.nonFinite > 0 || metrics.peak > 0.99) return [Number.NaN];
        results.push(metrics.rmsDb);
      }
      return results;
    }, reel);
    for (const [position, level] of levels.entries()) {
      expect(level, `${reel} ${position}`).toBeGreaterThan(-30);
      expect(level, `${reel} ${position}`).toBeLessThan(-9);
    }
  }
  expect(errors).toEqual([]);
});

test("renders the song from intro to outro and a jackpot's bonus round, never clipping", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("./?audio-test=1");
  await expect(page.locator("html")).toHaveAttribute("data-audio-test", "ready");

  const song = await page.evaluate(() => window.__jackpopTest!.render({ mode: "song", tempo: 180, seconds: 36 * 4 * (60 / 180) + 1.5, voice: true }));
  expect(song.sections).toEqual(["Intro", "Strophe", "Refrain", "Drop", "Refrain ↑", "Outro"]);
  expect(song.ended).toBe(true);
  expect(song.nonFinite).toBe(0);
  expect(song.peak).toBeLessThanOrEqual(0.99);
  expect(song.rmsDb).toBeGreaterThan(-24);

  const bonus = await page.evaluate(() => window.__jackpopTest!.render({ pull: 0.5, jackpot: true, seconds: 16 }));
  expect(bonus.sections).toEqual(["Bonus-Drop", "Rückung", "Loop"]);
  expect(bonus.peak).toBeLessThanOrEqual(0.99);

  const songJackpot = await page.evaluate(() => window.__jackpopTest!.render({ mode: "song", pull: 0.5, jackpot: true, seconds: 10 }));
  expect(songJackpot.sections[0], "ein Jackpot springt im Song direkt in den Drop").toBe("Drop");
});

test("the choir from the voice joins on the high points of the song only", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("./?audio-test=1");
  await expect(page.locator("html")).toHaveAttribute("data-audio-test", "ready");

  // The voice alone through intro, verse, chorus, drop and two bars of the lifted chorus.
  const sung = await page.evaluate(() => window.__jackpopTest!.render({ mode: "song", tempo: 180, seconds: 26 * 4 * (60 / 180) + 0.2, voice: true, solo: "voice" }));
  const bar = (index: number) => sung.bars[index]!;
  const width = (index: number) => bar(index).sideDb - bar(index).rmsDb;
  expect(sung.nonFinite).toBe(0);
  // Chorus bars 12–15: the lead alone, in the middle.
  for (const index of [12, 13]) expect(width(index), `Refrain, Takt ${index}`).toBeLessThan(-20);
  // From its second half the choir stands left and right.
  for (const index of [16, 17]) {
    expect(width(index), `Refrain mit Chor, Takt ${index}`).toBeGreaterThan(-16);
    expect(bar(index).sideDb - bar(index - 4).sideDb, `Chor in Takt ${index}`).toBeGreaterThan(8);
  }
  // No voice in the drop, the choir again in the lifted chorus.
  for (const index of [21, 22]) expect(bar(index).rmsDb, `Drop, Takt ${index}`).toBeLessThan(-40);
  for (const index of [24, 25]) expect(width(index), `Refrain ↑, Takt ${index}`).toBeGreaterThan(-16);
});

test("after a jackpot the choir sings the key change with the voice", async ({ page }) => {
  const errors = watchErrors(page);
  await open(page, "?audio-test=1");
  await hold(page, "[data-coin-slot]", 2_600);
  await expect(page.locator("[data-banner]")).toHaveText("Stimme ist drin!", { timeout: 10_000 });
  await expect(page.locator(".coin")).toHaveAttribute("data-choir", "ready");
  await expect(page.locator("[data-choir-singing]"), "im normalen Loop singt die Stimme allein").toHaveCount(0);

  await page.evaluate(() => window.__jackpopTest!.forceNextSpin({ beat: 0, chords: 0, hook: 0, bass: 0 }));
  await pullLever(page);
  await expect(page.locator("[data-banner]")).toContainText("Jackpot!", { timeout: 10_000 });
  await expect(page.locator("[data-section]")).toHaveText("Rückung", { timeout: 15_000 });
  await expect(page.locator("[data-choir-singing]")).toHaveText("+ Chor");
  await expect(page.locator("[data-choir-singing]")).toHaveCount(0, { timeout: 10_000 });

  await page.locator("[data-mode]").tap();
  await expect(page.locator(".song-part.choir"), "die Song-Karte zeigt, wo der Chor singt").toHaveCount(2);
  expect(errors).toEqual([]);
});

test("song mode plays the song form and shows where it is", async ({ page }) => {
  const errors = watchErrors(page);
  await open(page);
  await page.locator("[data-mode]").tap();
  await expect(page.locator("[data-mode]")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".song-part")).toHaveCount(6);
  await expect(page.locator(".song-part.choir"), "ohne Stimme kein Chor").toHaveCount(0);
  await page.locator("[data-play]").tap();
  await expect(page.locator("[data-section]")).toHaveText("Intro");
  await expect(page.locator(".song-part.now")).toHaveCount(1);
  await expect(page.locator("[data-section]")).toHaveText("Strophe", { timeout: 10_000 });
  await page.reload();
  await expect(page.locator("[data-mode]")).toHaveAttribute("aria-pressed", "true");
  expect(errors).toEqual([]);
});

test("a jackpot unlocks a diamond that counts as a joker", async ({ page }) => {
  test.setTimeout(60_000);
  const errors = watchErrors(page);
  await open(page, "?audio-test=1");
  await page.evaluate(() => window.__jackpopTest!.forceNextSpin({ beat: 0, chords: 0, hook: 0, bass: 0 }));
  await pullLever(page);
  await expect(page.locator("[data-banner]")).toHaveText("4 × Herz: Mega-Jackpot!", { timeout: 10_000 });
  await expect(page.locator("[data-banner]")).toContainText("Diamant auf der Beat-Walze", { timeout: 8_000 });

  // The beat reel now has a thirteenth symbol above its first one.
  await page.locator('[data-nudge-up="beat"]').tap();
  await expect(page.locator('.reel[data-reel="beat"]')).toHaveAttribute("data-family", "rare");
  await page.locator('.reel[data-reel="beat"]').tap();
  await expect(page.locator("[data-variant-name]")).toHaveText("Diamant-Beat");
  await page.locator("[data-sheet-backdrop]").click({ position: { x: 20, y: 20 } });

  await page.locator('[data-hold="beat"]').tap();
  await page.evaluate(() => window.__jackpopTest!.forceNextSpin({ chords: 0, hook: 0, bass: 5 }));
  await pullLever(page);
  await expect(page.locator("[data-banner]")).toHaveText("3 × Herz mit Joker: Jackpot!", { timeout: 10_000 });
  await expect(page.locator("[data-banner]")).toContainText("Diamant auf der Bass-Walze", { timeout: 8_000 });
  expect(errors).toEqual([]);
});

/** Replaces the Android share sheet with a recorder, so the test sees what would be shared. */
async function recordSharing(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const shared: { title: string | undefined; text: string | undefined; url: string | undefined; files: { name: string; type: string; size: number }[] | undefined }[] = [];
    (window as unknown as { shared: typeof shared; sharedFile: File | null }).shared = shared;
    Object.defineProperty(navigator, "canShare", { value: () => true, configurable: true });
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async (data: ShareData) => {
        shared.push({ title: data.title, text: data.text, url: data.url, files: data.files?.map((file) => ({ name: file.name, type: file.type, size: file.size })) });
        if (data.files?.[0]) (window as unknown as { sharedFile: File }).sharedFile = data.files[0];
      },
    });
  });
}

const shared = (page: Page) => page.evaluate(() => (window as unknown as { shared: { title?: string; text?: string; url?: string; files?: { name: string; type: string; size: number }[] }[] }).shared);

test("the ticket prints the song with the voice as Ogg Opus and shares it and the recipe", async ({ page, browser }) => {
  test.setTimeout(120_000);
  const errors = watchErrors(page);
  await recordSharing(page);
  await open(page);
  await hold(page, "[data-coin-slot]", 2_600);
  await expect(page.locator("[data-banner]")).toHaveText("Stimme ist drin!", { timeout: 10_000 });

  await page.locator("[data-ticket]").tap();
  const sheet = page.locator("[data-ticket-sheet]");
  await expect(sheet).toHaveAttribute("data-state", "printing");
  await expect(sheet.locator("[data-ticket-title]")).toHaveText("Zuckerwatte-Party");
  await expect(sheet).toContainText("mit deiner Stimme");
  await expect(sheet).toHaveAttribute("data-state", "ready", { timeout: 90_000 });
  await expect(page.locator("[data-play]"), "die Maschine schweigt, solange das Ticket gedruckt wird").toHaveAttribute("aria-pressed", "false");
  await expect(sheet.locator("[data-ticket-audio]")).toHaveAttribute("src", /^blob:/);

  await sheet.locator("[data-ticket-share]").tap();
  const song = (await shared(page))[0]!;
  expect(song.files).toHaveLength(1);
  expect(song.files![0]!.name).toBe("jackpop-zuckerwatte-party.ogg");
  expect(song.files![0]!.type).toBe("audio/ogg");
  expect(song.files![0]!.size).toBeGreaterThan(300_000);
  expect(song.files![0]!.size).toBeLessThan(2_500_000);
  const decoded = await page.evaluate(async () => {
    const file = (window as unknown as { sharedFile: File }).sharedFile;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const audio = await new OfflineAudioContext(2, 48_000, 48_000).decodeAudioData(bytes.buffer.slice(0));
    let peak = 0;
    for (let channel = 0; channel < audio.numberOfChannels; channel += 1) for (const sample of audio.getChannelData(channel)) peak = Math.max(peak, Math.abs(sample));
    return { magic: new TextDecoder().decode(bytes.subarray(0, 4)), seconds: audio.duration, peak };
  });
  expect(decoded.magic).toBe("OggS");
  expect(decoded.seconds).toBeGreaterThan(59);
  expect(decoded.seconds).toBeLessThan(61);
  expect(decoded.peak).toBeGreaterThan(0.3);
  expect(decoded.peak).toBeLessThanOrEqual(1);

  await sheet.locator("[data-ticket-recipe]").tap();
  const recipe = (await shared(page))[1]!;
  expect(recipe.url).toMatch(/\/Jackpop\/#rezept=[A-Za-z0-9_-]+$/);
  expect(recipe.text).toContain("Zuckerwatte-Party");
  await sheet.locator("[data-ticket-close]").tap();
  await expect(sheet).toHaveCount(0);
  expect(errors).toEqual([]);

  // A friend opens the recipe on their own phone: same line, no voice.
  const friendContext = await browser.newContext({ ...devices["Pixel 7"] });
  const friend = await friendContext.newPage();
  await friend.goto(recipe.url!.replace(/^https?:\/\/[^/]+/, `http://127.0.0.1:${port}`));
  await expect(friend.locator("[data-banner]")).toContainText("Rezept geladen: Zuckerwatte-Party.");
  await friend.locator("[data-help-close]").tap();
  expect(await families(friend)).toEqual(["club", "sweet", "sweet", "sweet"]);
  await expect(friend.locator("[data-voice-mute]")).toHaveCount(0);
  expect(friend.url()).not.toContain("rezept");
  await friendContext.close();
});

test("without a share sheet the ticket is saved as a file", async ({ page }) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => { Object.defineProperty(navigator, "share", { value: undefined, configurable: true }); });
  await open(page);
  await page.locator("[data-ticket]").tap();
  await expect(page.locator("[data-ticket-sheet]")).toHaveAttribute("data-state", "ready", { timeout: 90_000 });
  await expect(page.locator("[data-ticket-sheet]")).toContainText("ohne Stimme");
  const download = page.waitForEvent("download");
  await page.locator("[data-ticket-share]").tap();
  expect((await download).suggestedFilename()).toBe("jackpop-zuckerwatte-party.ogg");
});

test("a recipe with a diamond brings the diamond along as a gift", async ({ page, browser }) => {
  test.setTimeout(120_000);
  await recordSharing(page);
  await open(page, "?audio-test=1");
  await page.evaluate(() => window.__jackpopTest!.forceNextSpin({ beat: 0, chords: 0, hook: 0, bass: 0 }));
  await pullLever(page);
  await expect(page.locator("[data-banner]")).toContainText("Diamant auf der Beat-Walze", { timeout: 12_000 });
  await page.locator("[data-play]").tap();
  await page.locator('[data-nudge-up="beat"]').tap();
  await expect(page.locator('.reel[data-reel="beat"]')).toHaveAttribute("data-family", "rare");
  await page.locator("[data-ticket]").tap();
  await expect(page.locator("[data-ticket-title]")).toHaveText("Zuckerwatte-Jackpot");
  await expect(page.locator("[data-ticket-sheet]")).toHaveAttribute("data-state", "ready", { timeout: 90_000 });
  await page.locator("[data-ticket-recipe]").tap();
  const url = (await shared(page))[0]!.url!;

  const friendContext = await browser.newContext({ ...devices["Pixel 7"] });
  const friend = await friendContext.newPage();
  await friend.goto(url.replace(/^https?:\/\/[^/]+/, `http://127.0.0.1:${port}`));
  await expect(friend.locator("[data-banner]")).toContainText("Dazu ein Diamant als Geschenk!");
  await friend.locator("[data-help-close]").tap();
  await expect(friend.locator('.reel[data-reel="beat"]')).toHaveAttribute("data-family", "rare");
  await friendContext.close();
});

/** Starts the page with a machine that has gone `dry` pulls without a jackpot. */
async function withDryPulls(page: Page, dry: number): Promise<void> {
  await page.addInitScript((pulls) => {
    if (!localStorage.getItem("jackpop.stats.v1")) localStorage.setItem("jackpop.stats.v1", JSON.stringify({ pulls, jackpots: 0, best: null, unlocked: [], dry: pulls }));
  }, dry);
}

test("the machine gets impatient after dry pulls and says so", async ({ page }) => {
  const errors = watchErrors(page);
  await withDryPulls(page, 4);
  await open(page, "?audio-test=1");
  await expect(page.locator("[data-mood]")).toHaveAttribute("data-mood", "happy");
  await page.evaluate(() => window.__jackpopTest!.forceNextSpin({ beat: 1, chords: 2, hook: 3, bass: 4 }));
  await pullLever(page);
  await expect(page.locator("[data-banner]")).toHaveText("Die Maschine wird ungeduldig …", { timeout: 10_000 });
  await expect(page.locator("[data-mood]")).toHaveAttribute("data-mood", "impatient");
  await expect(page.locator(".cabinet")).toHaveClass(/mood-impatient/);
  expect(errors).toEqual([]);
});

test("a boiling machine gives in on the fourteenth dry pull", async ({ page }) => {
  const errors = watchErrors(page);
  await withDryPulls(page, 13);
  await open(page);
  await expect(page.locator("[data-mood]")).toHaveAttribute("data-mood", "hot");
  await expect(page.locator(".cabinet")).toHaveClass(/mood-hot/);
  await pullLever(page);
  await expect(page.locator(".reel.spinning").first()).toBeVisible();
  await expect(page.locator("[data-mood]"), "die Laune verrät den Jackpot nicht, bevor die Walzen stehen").toHaveAttribute("data-mood", "hot");
  await expect(page.locator("[data-stats]")).toContainText("13 Züge · 0");
  await expect(page.locator("[data-banner]")).toContainText("Jackpot!", { timeout: 10_000 });
  await expect(page.locator("[data-mood]")).toHaveAttribute("data-mood", "happy");
  expect(errors).toEqual([]);
});

test("installs as an app: manifest and icons load, and after one visit it starts offline with line, voice and mood", async ({ page, context }) => {
  const errors = watchErrors(page);
  await withDryPulls(page, 6);
  await open(page);
  const manifestUrl = await page.locator('link[rel="manifest"]').getAttribute("href");
  const manifest = await (await page.request.get(manifestUrl!)).json() as { start_url: string; scope: string; display: string; orientation: string; icons: { src: string; sizes: string; purpose: string }[] };
  expect(manifest).toMatchObject({ start_url: "/Jackpop/", scope: "/Jackpop/", display: "standalone", orientation: "portrait" });
  expect(manifest.icons.map((icon) => `${icon.sizes} ${icon.purpose}`)).toEqual(["192x192 any", "512x512 any", "512x512 maskable"]);
  for (const src of [...manifest.icons.map((icon) => icon.src), "apple-touch-icon.png"]) {
    const response = await page.request.get(new URL(src, new URL(manifestUrl!, page.url())).href);
    expect(response.headers()["content-type"], src).toBe("image/png");
  }

  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 10_000 });
  const client = await page.context().newCDPSession(page);
  const { errors: manifestErrors } = await client.send("Page.getAppManifest");
  expect(manifestErrors, "Chrome liest das Manifest ohne Fehler").toEqual([]);
  const { installabilityErrors } = await client.send("Page.getInstallabilityErrors");
  expect(installabilityErrors, "Chrome bietet die Installation an").toEqual([]);
  await client.detach();
  await hold(page, "[data-coin-slot]", 2_600);
  await expect(page.locator("[data-banner]")).toHaveText("Stimme ist drin!", { timeout: 10_000 });
  await expect(page.locator(".coin")).toHaveAttribute("data-choir", "ready");
  const line = await families(page);

  await context.setOffline(true);
  await page.reload();
  await expect(page.locator(".reel").first(), "offline aus dem Speicher des Handys").toBeVisible();
  expect(await families(page)).toEqual(line);
  await expect(page.locator("[data-mood]")).toHaveAttribute("data-mood", "impatient");
  await expect(page.locator("[data-voice-mute]")).toBeVisible();
  await page.locator("[data-play]").tap();
  await expect(page.locator("[data-play]")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".coin"), "die Stimme wird auch offline gestimmt, samt Chor").toHaveAttribute("data-choir", "ready", { timeout: 10_000 });
  await page.locator("[data-play]").tap();
  await context.setOffline(false);
  expect(errors).toEqual([]);
});

test("offers no test hook without the local query", async ({ page }) => {
  await page.goto("./");
  expect(await page.evaluate(() => window.__jackpopTest)).toBeUndefined();
});
