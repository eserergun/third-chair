// Sound kit check.
//
// Starts a Vite dev server (port 5182, base /third-chair/), opens dev/audio.html in headless
// Chromium, renders every sound offline and measures it, then drives the live path with
// real clicks: mute default, unlock on a gesture, every pad, pan, delay, bad input, a flood,
// mute again, persistence across reloads, blocked storage, and two tabs.
//
//   npx tsx scripts/audio-check.ts                          headless, fake audio output
//   AUDIO_CHECK_LISTEN=1 npx tsx scripts/audio-check.ts     headed, audible
//   AUDIO_CHECK_VERBOSE=1 npx tsx scripts/audio-check.ts    print each step to stderr
//
// Headless runs pass --disable-audio-output: Chromium then renders Web Audio on a timer-driven
// fake output instead of the sound card, so the audio clock runs in real time even on a busy
// machine or a CI runner with no audio device (and nothing is heard).
//
// Every step has a time limit. A stalled browser fails one named check (with the last step it
// reached) instead of hanging the run. Exit code 0 when every check passes, 1 otherwise.

import path from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createServer, type ViteDevServer } from "vite";
import { chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { analyze, peakLoudness, problems, RULES, type SoundStats } from "../src/audio/analyze";
import { SFX, duration, type Sfx } from "../src/audio/sfx";
// Type-only: brings in the window.__sfxDev typing (and type-checks dev/audio.ts with the project).
import type {} from "../dev/audio";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 5182;
const BASE = "/third-chair/";
const RATES = [44100, 48000] as const;
const LISTEN = process.env.AUDIO_CHECK_LISTEN === "1";
const VERBOSE = process.env.AUDIO_CHECK_VERBOSE === "1";
/** Meter level that counts as silence in the live checks. */
const SILENT = 0.001;
/** The compressor looks ahead about 6 ms, so a sound may run that much past its length. */
const LENGTH_SLACK = 0.012;
/** Time limits in ms. A normal run takes about 16 s in total. */
const ACTION_MS = 10_000;
const RENDER_MS = 20_000;
const GROUP_MS = 60_000;
const CLOSE_MS = 15_000;
const WATCHDOG_MS = 420_000;

/** Makes localStorage throw on every access, like some privacy modes. */
const BLOCK_STORAGE =
  "Object.defineProperty(window, 'localStorage', { configurable: true, get: function () { throw new DOMException('Storage is blocked', 'SecurityError'); } });";

interface Check {
  readonly name: string;
  readonly pass: boolean;
  readonly detail: string;
}

interface Row {
  readonly sound: Sfx;
  readonly rate: number;
  readonly stats: SoundStats;
  /** Loudest K-weighted 100 ms window (LUFS): the mix is balanced on this. */
  readonly short: number;
  readonly bad: readonly string[];
}

interface Recorder {
  readonly checks: Check[];
  /** Page errors and console errors from every page. */
  readonly errors: string[];
  check(name: string, pass: boolean, detail?: string): void;
}

// ---------------------------------------------------------------------------------------
// Tracing and time limits

const started = Date.now();
let lastStep = "start";

/** Remember the current step (timeout errors name it). AUDIO_CHECK_VERBOSE=1 prints it. */
function mark(step: string): void {
  lastStep = step;
  if (VERBOSE) console.error(`[${((Date.now() - started) / 1000).toFixed(1)} s] ${step}`);
}

function message(e: unknown): string {
  return e instanceof Error ? (e.message.split("\n")[0] ?? e.message) : String(e);
}

/** Settle like `p`, or reject after `ms` with an error that names the last step. */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label}: no answer after ${ms / 1000} s (last step: ${lastStep})`));
    }, ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

function recorder(): Recorder {
  const checks: Check[] = [];
  const errors: string[] = [];
  return {
    checks,
    errors,
    check(name: string, pass: boolean, detail = ""): void {
      checks.push({ name, pass, detail });
      mark(`${pass ? "PASS" : "FAIL"} ${name}`);
    },
  };
}

/**
 * Run one scenario in its own browser context under a time budget. A stall or an exception
 * becomes one failing check; the next scenario still runs.
 */
async function runGroup(
  browser: Browser,
  rec: Recorder,
  name: string,
  body: (context: BrowserContext) => Promise<void>,
  initScript?: string,
): Promise<void> {
  mark(`group "${name}"`);
  let context: BrowserContext | null = null;
  try {
    context = await withTimeout(browser.newContext(), CLOSE_MS, "new browser context");
    context.setDefaultTimeout(ACTION_MS);
    if (initScript) await context.addInitScript({ content: initScript });
    await withTimeout(body(context), GROUP_MS, `group "${name}"`);
  } catch (e) {
    rec.check(`Group "${name}" ran to the end`, false, message(e));
  } finally {
    if (context) await withTimeout(context.close(), CLOSE_MS, "close context").catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------------------
// Server and page helpers

async function startServer(): Promise<{ server: ViteDevServer; url: string }> {
  const make = (port: number, strictPort: boolean): Promise<ViteDevServer> =>
    createServer({
      configFile: false,
      root: ROOT,
      base: BASE,
      appType: "mpa",
      logLevel: "warn",
      clearScreen: false,
      cacheDir: path.join(tmpdir(), "standoff-audio-check-vite"),
      server: { host: "127.0.0.1", port, strictPort, hmr: false },
      optimizeDeps: { noDiscovery: true, entries: [] },
    });
  let server = await make(PORT, true);
  try {
    await server.listen();
  } catch {
    await server.close();
    console.warn(`Port ${PORT} is busy. Using the next free port.`);
    server = await make(PORT + 1, false);
    await server.listen();
  }
  const address = server.httpServer?.address();
  const port = typeof address === "object" && address !== null ? address.port : PORT;
  return { server, url: `http://127.0.0.1:${port}${BASE}dev/audio.html` };
}

async function waitReady(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__sfxDev?.ready === true, null, { timeout: 15000 });
}

async function openPage(context: BrowserContext, url: string, errors: string[]): Promise<Page> {
  mark(`open ${url.slice(url.indexOf(BASE))}`);
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(`page error: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console error: ${m.text()}`);
  });
  await page.goto(url);
  await waitReady(page);
  return page;
}

async function until(page: Page, fn: () => boolean, timeout: number): Promise<boolean> {
  try {
    await page.waitForFunction(fn, null, { timeout, polling: 20 });
    return true;
  } catch {
    return false;
  }
}

async function untilPeak(page: Page, min: number, timeout: number): Promise<boolean> {
  try {
    await page.waitForFunction(
      (m) => {
        const p = window.__sfxDev?.peak();
        return p !== undefined && Math.max(p.left, p.right) >= m;
      },
      min,
      { timeout, polling: 20 },
    );
    return true;
  } catch {
    return false;
  }
}

async function meter(page: Page): Promise<number> {
  return page.evaluate(() => {
    const p = window.__sfxDev?.peak();
    return p ? Math.max(p.left, p.right) : 0;
  });
}

async function resetPeak(page: Page): Promise<void> {
  await page.evaluate(() => window.__sfxDev?.resetPeak());
}

function decode(b64: string): Float32Array {
  const bytes = Buffer.from(b64, "base64");
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return new Float32Array(copy.buffer, 0, Math.floor(copy.length / 4));
}

const f3 = (x: number): string => x.toFixed(3);
const f4 = (x: number): string => x.toFixed(4);

function table(rows: readonly (readonly string[])[]): string {
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => r[i].length)));
  return rows.map((r) => r.map((c, i) => c.padEnd(widths[i])).join("  ").trimEnd()).join("\n");
}

// ---------------------------------------------------------------------------------------
// Offline renders

async function offlineSuite(page: Page, rec: Recorder): Promise<Row[]> {
  const rows: Row[] = [];
  const pageSounds = await page.evaluate(() => window.__sfxDev?.sounds.join(",") ?? "");
  rec.check("Page and module list the same nine sounds", pageSounds === SFX.join(",") && SFX.length === 9, pageSounds);
  for (const rate of RATES) {
    for (const sound of SFX) {
      mark(`render ${sound} at ${rate} Hz`);
      const b64 = await withTimeout(
        page.evaluate(([s, r]) => window.__sfxDev?.render(s, r) ?? "", [sound, rate] as const),
        RENDER_MS,
        `render ${sound} at ${rate} Hz`,
      );
      const samples = decode(b64);
      const stats = analyze(samples, rate);
      const bad = problems(stats);
      const declared = duration(sound);
      if (stats.audible > declared + LENGTH_SLACK) {
        bad.push(`runs past duration(): ${f3(stats.audible)} s > ${f3(declared)} s`);
      }
      rows.push({ sound, rate, stats, short: peakLoudness(samples, rate, 0.1), bad });
    }
    const set = rows.filter((r) => r.rate === rate);
    const loudest = set.reduce((m, r) => (r.short > m.short ? r : m));
    const softest = set.reduce((m, r) => (r.short < m.short ? r : m));
    rec.check(
      `Mix order at ${rate} Hz: shot loudest, tick softest`,
      loudest.sound === "shot" && softest.sound === "tick",
      `loudest=${loudest.sound} softest=${softest.sound}`,
    );
  }
  // Seeded renders repeat. The browser's DSP may differ in the last float bit, so compare
  // with a tolerance far below audibility (1e-5 is -100 dB).
  mark("render scatter twice");
  const [a, b] = await withTimeout(
    page.evaluate(async () => {
      const h = window.__sfxDev;
      return h ? [await h.render("scatter", 44100), await h.render("scatter", 44100)] : ["", ""];
    }),
    RENDER_MS,
    "render scatter twice",
  );
  const x = decode(a);
  const y = decode(b);
  let maxDiff = x.length === y.length && x.length > 0 ? 0 : Number.POSITIVE_INFINITY;
  for (let i = 0; i < Math.min(x.length, y.length); i++) maxDiff = Math.max(maxDiff, Math.abs(x[i] - y[i]));
  rec.check("Offline renders repeat (seeded; max sample difference < 1e-5)", maxDiff < 1e-5, `max difference=${maxDiff.toExponential(1)}`);
  return rows;
}

// ---------------------------------------------------------------------------------------
// Live path, one scenario per group

/** A fresh visitor: mute default, unlock, every pad, pan, delay, bad input, flood, mute again. */
async function freshVisitor(context: BrowserContext, url: string, rec: Recorder): Promise<void> {
  const page = await openPage(context, url, rec.errors);
  const first = await page.evaluate(() => {
    const h = window.__sfxDev;
    return { muted: h?.isMuted(), status: h?.status(), contexts: h?.contexts() };
  });
  rec.check(
    "Fresh visitor: muted, no AudioContext",
    first.muted === true && first.status === "muted" && first.contexts === 0,
    `status=${first.status} contexts=${first.contexts}`,
  );

  mark("click a pad while muted");
  await page.click('[data-sfx="shot"]');
  await page.waitForTimeout(500);
  const mutedPeak = await meter(page);
  const mutedContexts = await page.evaluate(() => window.__sfxDev?.contexts());
  rec.check(
    "Pad click while muted: silent, no AudioContext",
    mutedPeak < SILENT && mutedContexts === 0,
    `peak=${f4(mutedPeak)} contexts=${mutedContexts}`,
  );

  mark("click the sound toggle");
  await page.click("#mute");
  const ready = await until(page, () => window.__sfxDev?.status() === "ready", 3000);
  const stored = await page.evaluate(() => localStorage.getItem("standoff.sound"));
  rec.check("Sound toggle click unlocks audio", ready, `status=${await page.evaluate(() => window.__sfxDev?.status())}`);
  // Every live check below needs a running audio clock. Measure it once.
  const c0 = await page.evaluate(() => window.__sfxDev?.clock() ?? 0);
  await page.waitForTimeout(500);
  const c1 = await page.evaluate(() => window.__sfxDev?.clock() ?? 0);
  const clockRate = (c1 - c0) / 0.5;
  rec.check("Audio clock runs in real time (0.8x to 1.25x)", clockRate > 0.8 && clockRate < 1.25, `rate=${clockRate.toFixed(2)}x`);
  rec.check('Choice stored: standoff.sound = "on"', stored === "on", `value=${stored}`);

  for (const sound of SFX) {
    mark(`live pad ${sound}`);
    await resetPeak(page);
    await page.click(`[data-sfx="${sound}"]`);
    const heard = await untilPeak(page, 0.01, 2000);
    await page.waitForTimeout(duration(sound) * 1000 + 120);
    const peak = await meter(page);
    rec.check(`Live pad "${sound}": audible, peak <= 1`, heard && peak <= 1, `peak=${f3(peak)}`);
  }

  mark("pan -1");
  await resetPeak(page);
  await page.evaluate(() => window.__sfxDev?.play("shot", { pan: -1 }));
  await page.waitForTimeout(duration("shot") * 1000 + 150);
  const lr = await page.evaluate(() => window.__sfxDev?.peak() ?? { left: 0, right: 0 });
  rec.check("Pan -1: left only", lr.left > 0.01 && lr.right < SILENT, `L=${f3(lr.left)} R=${f4(lr.right)}`);

  mark("pan 0.6");
  await resetPeak(page);
  await page.evaluate(() => window.__sfxDev?.play("shot", { pan: 0.6 }));
  await page.waitForTimeout(duration("shot") * 1000 + 150);
  const lr2 = await page.evaluate(() => window.__sfxDev?.peak() ?? { left: 0, right: 0 });
  rec.check("Pan 0.6: right louder than left", lr2.right > lr2.left && lr2.left > 0.001, `L=${f3(lr2.left)} R=${f3(lr2.right)}`);

  mark("delay 0.6 s");
  await resetPeak(page);
  await page.evaluate(() => window.__sfxDev?.play("card", { delay: 0.6 }));
  await page.waitForTimeout(250);
  const early = await meter(page);
  const late = await untilPeak(page, 0.01, 2000);
  rec.check("Delay 0.6 s: silent first, then plays", early < SILENT && late, `peak at 250 ms=${f4(early)}`);

  mark("bad input");
  const threw = await page.evaluate(() => {
    const h = window.__sfxDev;
    if (!h) return "no hooks";
    try {
      h.play("nope" as Sfx);
      h.play(undefined as unknown as Sfx);
      h.play("shot", { pan: Number.NaN, delay: -5, volume: 9 });
      h.play("coin", { delay: Number.POSITIVE_INFINITY, pan: 40 });
      h.setMuted(false);
      h.unlock();
      return "";
    } catch (e) {
      return String(e);
    }
  });
  rec.check("Bad input never throws", threw === "", threw);

  mark("flood of 200 shots");
  await page.waitForTimeout(800);
  await resetPeak(page);
  const floodError = await page.evaluate(() => {
    try {
      for (let i = 0; i < 200; i += 1) window.__sfxDev?.play("shot");
      return "";
    } catch (e) {
      return String(e);
    }
  });
  await page.waitForTimeout(900);
  const flood = await meter(page);
  rec.check(
    "200 shots at once: no throw, limiter keeps peak <= 1",
    floodError === "" && flood > 0.01 && flood <= 1,
    `peak=${f3(flood)}`,
  );

  mark("mute again");
  await page.click("#mute");
  const mutedNow = await page.evaluate(() => window.__sfxDev?.isMuted());
  await page.waitForTimeout(300);
  await page.click('[data-sfx="shot"]');
  await page.waitForTimeout(500);
  const after = await meter(page);
  rec.check("Mute again: pads go silent", mutedNow === true && after < SILENT, `peak=${f4(after)}`);
  const suspended = await until(page, () => window.__sfxDev?.contextState() === "suspended", 2000);
  rec.check("Muted AudioContext suspends", suspended, `state=${await page.evaluate(() => window.__sfxDev?.contextState())}`);
  const storedOff = await page.evaluate(() => localStorage.getItem("standoff.sound"));
  rec.check('Choice stored: standoff.sound = "off"', storedOff === "off", `value=${storedOff}`);

  mark("reload while muted");
  await page.reload();
  await waitReady(page);
  const reloaded = await page.evaluate(() => window.__sfxDev?.status());
  rec.check("Mute survives a reload", reloaded === "muted", `status=${reloaded}`);
}

/** A returning visitor who left sound on: locked until the first gesture. */
async function returningVisitor(context: BrowserContext, url: string, rec: Recorder): Promise<void> {
  const page = await openPage(context, url, rec.errors);
  mark("turn sound on, then reload");
  await page.click("#mute");
  await until(page, () => window.__sfxDev?.status() === "ready", 3000);
  await page.reload();
  await waitReady(page);
  const s1 = await page.evaluate(() => ({ status: window.__sfxDev?.status(), contexts: window.__sfxDev?.contexts() }));
  rec.check(
    "Sound on survives a reload; locked until a gesture",
    s1.status === "locked" && s1.contexts === 0,
    `status=${s1.status} contexts=${s1.contexts}`,
  );
  await page.close();

  // Playwright runs page.evaluate() as a user gesture, so the gesture-free path is probed
  // by the page itself: with ?boot-play it calls unlock() and play() while it loads.
  const fresh = await openPage(context, `${url}?boot-play`, rec.errors);
  const boot = await fresh.evaluate(() => window.__sfxDev?.boot() ?? null);
  rec.check(
    "Before any gesture: unlock() and play() start nothing",
    boot !== null && boot.hadGesture === false && boot.contexts === 0 && boot.status === "locked",
    `hadGesture=${boot?.hadGesture} contexts=${boot?.contexts} status=${boot?.status}`,
  );
  mark("first click in the fresh tab");
  await fresh.click('[data-sfx="coin"]');
  const heard = await untilPeak(fresh, 0.01, 2000);
  const s2 = await fresh.evaluate(() => window.__sfxDev?.status());
  rec.check("First click unlocks and plays", heard && s2 === "ready", `status=${s2}`);
  // The page shows status through subscribe(), so this proves subscribers heard the unlock.
  const chip = await fresh.textContent("#status");
  rec.check("Subscribers see the unlock (status chip reads Ready)", chip === "Ready", `chip=${chip}`);
}

/** Storage that throws on every access (some privacy modes). */
async function blockedStorage(context: BrowserContext, url: string, rec: Recorder): Promise<void> {
  const before = rec.errors.length;
  const page = await openPage(context, url, rec.errors);
  const s0 = await page.evaluate(() => window.__sfxDev?.status());
  mark("toggle sound with blocked storage");
  await page.click("#mute");
  const ready = await until(page, () => window.__sfxDev?.status() === "ready", 3000);
  await resetPeak(page);
  await page.click('[data-sfx="tick"]');
  const heard = await untilPeak(page, 0.01, 2000);
  rec.check(
    "Blocked storage: starts muted, toggle works in memory, no errors",
    s0 === "muted" && ready && heard && rec.errors.length === before,
    `status=${s0} ready=${ready} heard=${heard}`,
  );
}

/** Two tabs of the same site share the toggle. */
async function twoTabs(context: BrowserContext, url: string, rec: Recorder): Promise<void> {
  const a = await openPage(context, url, rec.errors);
  const b = await openPage(context, url, rec.errors);
  const c0 = await b.evaluate(() => window.__sfxDev?.changes() ?? 0);
  mark("toggle in tab A, watch tab B");
  await a.click("#mute");
  const on = await until(b, () => window.__sfxDev?.isMuted() === false, 2000);
  await a.click("#mute");
  const off = await until(b, () => window.__sfxDev?.isMuted() === true, 2000);
  const c1 = await b.evaluate(() => window.__sfxDev?.changes() ?? 0);
  rec.check(
    "Second tab follows the toggle and notifies subscribers",
    on && off && c1 - c0 >= 2,
    `on=${on} off=${off} notifications=${c1 - c0}`,
  );
}

// ---------------------------------------------------------------------------------------

function report(url: string, rows: readonly Row[], checks: readonly Check[]): number {
  console.log(`\nSound kit check: ${url}\n`);
  for (const rate of RATES) {
    const set = rows.filter((r) => r.rate === rate);
    if (set.length === 0) continue;
    console.log(`Offline renders at ${rate} Hz (mono, through the master chain)`);
    console.log(
      table([
        ["sound", "length", "window", "audible", "onset", "RMS", "peak", "tail", "LUFS-400ms", "LUFS-100ms", "result"],
        ...set.map((r) => [
          r.sound,
          `${f3(duration(r.sound))}s`,
          `${f3(r.stats.window)}s`,
          `${f3(r.stats.audible)}s`,
          `${(r.stats.onset * 1000).toFixed(1)}ms`,
          f4(r.stats.rms),
          f4(r.stats.peak),
          r.stats.tail.toExponential(1),
          r.stats.loudness.toFixed(1),
          r.short.toFixed(1),
          r.bad.length === 0 ? "PASS" : `FAIL: ${r.bad.join("; ")}`,
        ]),
      ]),
    );
    console.log("");
  }
  console.log(
    `Rules: RMS > ${RULES.minRms}, peak <= ${RULES.maxPeak}, audible < ${RULES.maxSeconds} s, ` +
      `last ${RULES.tailSeconds * 1000} ms under ${RULES.maxTail}, audible within duration() + ${LENGTH_SLACK * 1000} ms.\n`,
  );
  console.log("Behavior checks (Chromium, real clicks)");
  for (const c of checks) console.log(`${c.pass ? "PASS" : "FAIL"}  ${c.name}${c.detail ? `  (${c.detail})` : ""}`);
  const failed = rows.filter((r) => r.bad.length > 0).length + checks.filter((c) => !c.pass).length;
  const total = rows.length + checks.length;
  const expectedRows = RATES.length * SFX.length;
  console.log(`\n${total - failed}/${total} passed.`);
  // Missing rows (a stalled render) are a failure even if nothing else failed.
  return failed === 0 && rows.length === expectedRows ? 0 : 1;
}

async function main(): Promise<number> {
  const t0 = Date.now();
  const lap = (from: number): string => `${((Date.now() - from) / 1000).toFixed(1)} s`;
  mark("start Vite");
  const { server, url } = await withTimeout(startServer(), 30_000, "start Vite");
  const tServer = lap(t0);
  let browser: Browser | null = null;
  try {
    mark("launch Chromium");
    const t1 = Date.now();
    browser = await chromium.launch({
      headless: !LISTEN,
      args: LISTEN ? [] : ["--mute-audio", "--disable-audio-output"],
      timeout: 60_000,
    });
    const tLaunch = lap(t1);
    const rec = recorder();
    const rows: Row[] = [];

    const t2 = Date.now();
    await runGroup(browser, rec, "offline renders", async (context) => {
      const page = await openPage(context, url, rec.errors);
      rows.push(...(await offlineSuite(page, rec)));
    });
    const tOffline = lap(t2);

    const t3 = Date.now();
    await runGroup(browser, rec, "fresh visitor", (c) => freshVisitor(c, url, rec));
    await runGroup(browser, rec, "returning visitor", (c) => returningVisitor(c, url, rec));
    await runGroup(browser, rec, "blocked storage", (c) => blockedStorage(c, url, rec), BLOCK_STORAGE);
    await runGroup(browser, rec, "two tabs", (c) => twoTabs(c, url, rec));
    const tLive = lap(t3);

    rec.check("No page errors or console errors", rec.errors.length === 0, rec.errors.join(" | "));
    const code = report(url, rows, rec.checks);
    console.log(`Time: server ${tServer}, browser ${tLaunch}, offline ${tOffline}, live ${tLive}, total ${lap(t0)}.`);
    return code;
  } finally {
    mark("close");
    if (browser) await withTimeout(browser.close(), CLOSE_MS, "close Chromium").catch((e: unknown) => console.warn(message(e)));
    await withTimeout(server.close(), CLOSE_MS, "close Vite").catch((e: unknown) => console.warn(message(e)));
  }
}

// Last resort: never hang a CI job.
const watchdog = setTimeout(() => {
  console.error(`audio-check: no result after ${WATCHDOG_MS / 1000} s (last step: ${lastStep}). Giving up.`);
  process.exit(1);
}, WATCHDOG_MS);
watchdog.unref();

main().then(
  (code) => process.exit(code),
  (e: unknown) => {
    console.error(`audio-check failed at "${lastStep}": ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
    process.exit(1);
  },
);
