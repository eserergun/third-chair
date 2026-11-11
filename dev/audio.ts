// Dev page for the sound kit: one button per sound, a mute toggle, play options, short
// scenes, a live output meter, and an offline render table. It also exposes
// window.__sfxDev for scripts/audio-check.ts.

import { analyze, peakLoudness, problems } from "../src/audio/analyze";
import {
  SFX,
  isMuted,
  play,
  renderOffline,
  setMuted,
  status,
  subscribe,
  unlock,
  type PlayOptions,
  type Sfx,
  type SoundStatus,
} from "../src/audio/sfx";

export interface SfxDevHooks {
  readonly ready: true;
  readonly sounds: readonly Sfx[];
  status(): SoundStatus;
  isMuted(): boolean;
  setMuted(m: boolean): void;
  unlock(): void;
  play(s: Sfx, opts?: PlayOptions): void;
  /** Offline render, as base64 of the raw float32 samples (little-endian). */
  render(s: Sfx, sampleRate: number): Promise<string>;
  /** Largest absolute output sample per channel since the last resetPeak(). */
  peak(): { left: number; right: number };
  resetPeak(): void;
  /** How many AudioContexts connected to the speakers on this page. */
  contexts(): number;
  /** State of the newest AudioContext, or "none". */
  contextState(): string;
  /** currentTime of the newest AudioContext (0 if none). */
  clock(): number;
  /** How many times subscribe() listeners fired. */
  changes(): number;
  /** Result of the ?boot-play probe (null without the query flag). */
  boot(): BootProbe | null;
}

/** What happened when the page called unlock() and play() at load, before any gesture. */
export interface BootProbe {
  /** navigator.userActivation.hasBeenActive at that moment (null if the API is missing). */
  readonly hadGesture: boolean | null;
  readonly contexts: number;
  readonly status: SoundStatus;
}

declare global {
  interface Window {
    __sfxDev?: SfxDevHooks;
  }
}

// ---------------------------------------------------------------------------------------
// Output tap. Every connection to a live AudioContext's speakers is mirrored into a pair of
// analysers (left, right), so the page can show what really comes out. Dev only.

interface Tap {
  readonly ctx: AudioContext;
  readonly input: GainNode;
  readonly left: AnalyserNode;
  readonly right: AnalyserNode;
}

type Connect = (this: AudioNode, ...args: unknown[]) => unknown;

const taps: Tap[] = [];
const peaks = { left: 0, right: 0 };
const rawConnect = AudioNode.prototype.connect as unknown as Connect;

function link(from: AudioNode, to: AudioNode, output = 0): void {
  rawConnect.call(from, to, output);
}

function tapFor(ctx: AudioContext): Tap {
  const found = taps.find((t) => t.ctx === ctx);
  if (found) return found;
  // Up-mix to stereo the way the speakers do, then split into left and right.
  const input = ctx.createGain();
  input.channelCount = 2;
  input.channelCountMode = "explicit";
  input.channelInterpretation = "speakers";
  const split = ctx.createChannelSplitter(2);
  const left = ctx.createAnalyser();
  const right = ctx.createAnalyser();
  left.fftSize = 2048;
  right.fftSize = 2048;
  // A silent sink keeps the analysers in the rendered graph without adding sound.
  const sink = ctx.createGain();
  sink.gain.value = 0;
  link(input, split);
  link(split, left, 0);
  link(split, right, 1);
  link(left, sink);
  link(right, sink);
  link(sink, ctx.destination);
  const tap: Tap = { ctx, input, left, right };
  taps.push(tap);
  return tap;
}

function tappedConnect(this: AudioNode, ...args: unknown[]): unknown {
  const dest = args[0];
  if (dest instanceof AudioDestinationNode && this.context instanceof AudioContext) {
    link(this, tapFor(this.context).input, typeof args[1] === "number" ? args[1] : 0);
  }
  return rawConnect.apply(this, args);
}

AudioNode.prototype.connect = tappedConnect as unknown as AudioNode["connect"];

const frame = new Float32Array(2048);
const scopeData = new Float32Array(2048);

function maxAbs(x: Float32Array): number {
  let m = 0;
  for (let i = 0; i < x.length; i++) {
    const a = Math.abs(x[i]);
    if (a > m) m = a;
  }
  return m;
}

function sample(): void {
  for (const t of taps) {
    // A suspended context keeps its last frame. Skip it so the meter never reads stale sound.
    if (t.ctx.state !== "running") continue;
    t.left.getFloatTimeDomainData(frame);
    peaks.left = Math.max(peaks.left, maxAbs(frame));
    scopeData.set(frame);
    t.right.getFloatTimeDomainData(frame);
    peaks.right = Math.max(peaks.right, maxAbs(frame));
  }
}

setInterval(sample, 15);

// ---------------------------------------------------------------------------------------
// Page

const LABELS: Readonly<Record<Sfx, { name: string; note: string }>> = {
  shot: { name: "Gunshot", note: "Iron fires" },
  ricochet: { name: "Ricochet", note: "A bullet hits the table" },
  fall: { name: "Body fall", note: "A hit chair goes down" },
  duck: { name: "Duck", note: "Table: drop behind it" },
  card: { name: "Card slap", note: "A card goes down" },
  draw: { name: "Draw", note: "Hammer back, then locked" },
  tick: { name: "Tick", note: "The last ten seconds" },
  coin: { name: "Coin jingle", note: "A paid win" },
  scatter: { name: "Scatter", note: "Three quiet minutes" },
};

interface Cue {
  readonly s: Sfx;
  readonly delay: number;
  readonly pan?: number;
}

const SCENES: ReadonlyArray<{ readonly name: string; readonly cues: readonly Cue[] }> = [
  {
    name: "Shootout",
    cues: [
      { s: "draw", delay: 0, pan: -0.5 },
      { s: "draw", delay: 0.06, pan: 0.5 },
      { s: "shot", delay: 0.45, pan: -0.5 },
      { s: "shot", delay: 0.5, pan: 0.5 },
      { s: "fall", delay: 0.95, pan: 0.5 },
    ],
  },
  {
    name: "Duck and miss",
    cues: [
      { s: "duck", delay: 0, pan: 0.5 },
      { s: "draw", delay: 0.1, pan: -0.5 },
      { s: "shot", delay: 0.5, pan: -0.5 },
      { s: "ricochet", delay: 0.56, pan: 0.5 },
    ],
  },
  {
    name: "Cards down",
    cues: [
      { s: "card", delay: 0, pan: -0.6 },
      { s: "card", delay: 0.14 },
      { s: "card", delay: 0.27, pan: 0.6 },
    ],
  },
  {
    name: "Paid win",
    cues: [
      { s: "coin", delay: 0 },
      { s: "coin", delay: 0.32, pan: 0.3 },
    ],
  },
  {
    name: "Countdown",
    cues: [0, 1, 2, 3, 4].map((i) => ({ s: "tick" as const, delay: i })),
  },
  { name: "Scatter", cues: [{ s: "scatter", delay: 0 }] },
];

function el<T extends HTMLElement>(selector: string): T {
  const node = document.querySelector<T>(selector);
  if (!node) throw new Error(`Missing element ${selector}`);
  return node;
}

const muteButton = el<HTMLButtonElement>("#mute");
const statusChip = el<HTMLSpanElement>("#status");
const hint = el<HTMLParagraphElement>("#hint");
const pads = el<HTMLDivElement>("#pads");
const scenes = el<HTMLDivElement>("#scenes");
const panInput = el<HTMLInputElement>("#pan");
const delayInput = el<HTMLInputElement>("#delay");
const volumeInput = el<HTMLInputElement>("#volume");
const meter = el<HTMLParagraphElement>("#meter");
const scope = el<HTMLCanvasElement>("#scope");
const renderButton = el<HTMLButtonElement>("#render");
const table = el<HTMLTableElement>("#table");

const STATUS_TEXT: Readonly<Record<SoundStatus, string>> = {
  unsupported: "No Web Audio in this browser",
  muted: "Muted",
  locked: "On: click anywhere to start audio",
  ready: "Ready",
};

let changeCount = 0;

function showStatus(): void {
  const s = status();
  const m = isMuted();
  statusChip.textContent = STATUS_TEXT[s];
  statusChip.dataset.status = s;
  muteButton.textContent = m ? "Sound: off" : "Sound: on";
  muteButton.setAttribute("aria-pressed", String(!m));
  hint.textContent = m
    ? "Sound starts off. Turn it on, then press a pad or the keys 1 to 9. Key M toggles sound."
    : "Press a pad or the keys 1 to 9. Key M toggles sound.";
}

function options(): PlayOptions {
  return { pan: Number(panInput.value), delay: Number(delayInput.value), volume: Number(volumeInput.value) };
}

function showOptions(): void {
  el<HTMLOutputElement>("#pan-out").textContent = Number(panInput.value).toFixed(1);
  el<HTMLOutputElement>("#delay-out").textContent = `${Number(delayInput.value).toFixed(2)} s`;
  el<HTMLOutputElement>("#volume-out").textContent = Number(volumeInput.value).toFixed(2);
}

function trigger(s: Sfx, opts: PlayOptions): void {
  peaks.left = 0;
  peaks.right = 0;
  unlock();
  play(s, opts);
}

SFX.forEach((s, i) => {
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.sfx = s;
  const key = document.createElement("kbd");
  key.textContent = String(i + 1);
  const note = document.createElement("small");
  note.textContent = LABELS[s].note;
  button.append(key, LABELS[s].name, note);
  button.addEventListener("click", () => trigger(s, options()));
  pads.append(button);
});

for (const scene of SCENES) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = scene.name;
  button.addEventListener("click", () => {
    peaks.left = 0;
    peaks.right = 0;
    unlock();
    for (const cue of scene.cues) play(cue.s, { delay: cue.delay, pan: cue.pan ?? 0 });
  });
  scenes.append(button);
}

muteButton.addEventListener("click", () => setMuted(!isMuted()));
for (const input of [panInput, delayInput, volumeInput]) input.addEventListener("input", showOptions);

// Like the game: any gesture may unlock audio (it does nothing while muted).
window.addEventListener("pointerdown", unlock, { capture: true });
window.addEventListener("keydown", (e) => {
  unlock();
  if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
  if (e.key === "m" || e.key === "M") {
    setMuted(!isMuted());
    return;
  }
  const i = Number(e.key) - 1;
  if (Number.isInteger(i) && i >= 0 && i < SFX.length) trigger(SFX[i], options());
});

subscribe(() => {
  changeCount++;
  showStatus();
});
showStatus();
showOptions();

// ---------------------------------------------------------------------------------------
// Scope and meter

const g2d = scope.getContext("2d");

function drawScope(): void {
  if (g2d) {
    const w = scope.width;
    const h = scope.height;
    g2d.fillStyle = "#140c08";
    g2d.fillRect(0, 0, w, h);
    g2d.fillStyle = "#2f4a3c";
    g2d.fillRect(0, Math.floor(h / 2), w, 1);
    g2d.fillStyle = "#b8432f";
    const step = scopeData.length / w;
    for (let x = 0; x < w; x++) {
      let lo = 1;
      let hi = -1;
      const end = Math.floor((x + 1) * step);
      for (let i = Math.floor(x * step); i < end; i++) {
        const v = scopeData[i];
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      if (hi < lo) continue;
      const y0 = Math.round((1 - hi) * 0.5 * (h - 1));
      const y1 = Math.round((1 - lo) * 0.5 * (h - 1));
      g2d.fillRect(x, y0, 1, Math.max(1, y1 - y0 + 1));
    }
  }
  meter.textContent = `Peak since last play: L ${peaks.left.toFixed(3)} R ${peaks.right.toFixed(3)}`;
  requestAnimationFrame(drawScope);
}

requestAnimationFrame(drawScope);

// ---------------------------------------------------------------------------------------
// Offline table

function cell(row: HTMLTableRowElement, text: string, tag: "td" | "th" = "td", className = ""): void {
  const c = document.createElement(tag);
  c.textContent = text;
  if (className) c.className = className;
  row.append(c);
}

async function renderTable(): Promise<void> {
  renderButton.disabled = true;
  renderButton.textContent = "Rendering...";
  try {
    const rate = 44100;
    table.replaceChildren();
    const head = table.createTHead().insertRow();
    const headers = ["Sound", "Window", "Audible", "Onset", "RMS", "Peak", "Tail", "LUFS 400 ms", "LUFS 100 ms", "Result"];
    for (const h of headers) cell(head, h, "th");
    const body = table.createTBody();
    for (const s of SFX) {
      const samples = await renderOffline(s, rate);
      const st = analyze(samples, rate);
      const bad = problems(st);
      const row = body.insertRow();
      cell(row, LABELS[s].name);
      cell(row, `${st.window.toFixed(3)} s`);
      cell(row, `${st.audible.toFixed(3)} s`);
      cell(row, `${(st.onset * 1000).toFixed(1)} ms`);
      cell(row, st.rms.toFixed(4));
      cell(row, st.peak.toFixed(4));
      cell(row, st.tail.toExponential(1));
      cell(row, st.loudness.toFixed(1));
      cell(row, peakLoudness(samples, rate, 0.1).toFixed(1));
      cell(row, bad.length === 0 ? "PASS" : `FAIL: ${bad.join("; ")}`, "td", bad.length === 0 ? "pass" : "fail");
    }
  } catch (e) {
    table.replaceChildren();
    cell(table.insertRow(), `Offline render failed: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    renderButton.disabled = false;
    renderButton.textContent = "Render all offline";
  }
}

renderButton.addEventListener("click", () => {
  void renderTable();
});

// ---------------------------------------------------------------------------------------
// ?boot-play: call unlock() and play() at load, before any gesture, the way a game might
// by mistake. Nothing may start. scripts/audio-check.ts reads the result.

function bootProbe(): BootProbe | null {
  if (!new URLSearchParams(location.search).has("boot-play")) return null;
  const activation = (navigator as unknown as { userActivation?: { hasBeenActive: boolean } }).userActivation;
  const hadGesture = activation ? activation.hasBeenActive : null;
  unlock();
  play("shot");
  return { hadGesture, contexts: taps.length, status: status() };
}

const boot = bootProbe();

// ---------------------------------------------------------------------------------------
// Hooks for scripts/audio-check.ts

function toBase64(x: Float32Array): string {
  const bytes = new Uint8Array(x.buffer, x.byteOffset, x.byteLength);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

window.__sfxDev = {
  ready: true,
  sounds: SFX,
  status,
  isMuted,
  setMuted,
  unlock,
  play,
  render: async (s, sampleRate) => toBase64(await renderOffline(s, sampleRate)),
  peak: () => ({ left: peaks.left, right: peaks.right }),
  resetPeak: () => {
    peaks.left = 0;
    peaks.right = 0;
  },
  contexts: () => taps.length,
  contextState: () => (taps.length > 0 ? taps[taps.length - 1].ctx.state : "none"),
  clock: () => (taps.length > 0 ? taps[taps.length - 1].ctx.currentTime : 0),
  changes: () => changeCount,
  boot: () => boot,
};
