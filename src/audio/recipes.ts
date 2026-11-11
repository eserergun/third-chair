// Sound recipes for the Third Chair kit. Each recipe schedules a few oscillators and noise
// bursts on any BaseAudioContext, so the same code drives live play (AudioContext) and
// tests (OfflineAudioContext). No audio files. Pure TypeScript, no React, no DOM lookups.

import type { Sfx } from "./sfx";

/** Exponential ramps cannot reach zero, so envelopes fall to this (-80 dB) and then cut. */
const FLOOR = 1e-4;
/** Seconds of shared white noise per context. Longer than any single noise layer. */
const NOISE_SECONDS = 2;

type Wave = "sine" | "square" | "sawtooth" | "triangle";

/** Everything a recipe needs to schedule one sound. */
export interface Kit {
  readonly ctx: BaseAudioContext;
  /** Context time (seconds) when the sound starts. */
  readonly t: number;
  /** The voice bus. Every layer ends here. */
  readonly out: AudioNode;
  /** Uniform 0..1: Math.random live, a seeded generator offline. */
  readonly rand: () => number;
  readonly noise: AudioBuffer;
  /** The source that stops last. The caller cleans up the voice when it ends. */
  last: AudioScheduledSourceNode | null;
  lastStop: number;
}

export interface Recipe {
  /** Seconds from the start until every layer is silent and every source has stopped. */
  readonly length: number;
  /** Trim that sets this sound's place in the mix (linear gain). Tuned by measured loudness. */
  readonly gain: number;
  readonly build: (k: Kit) => void;
}

// ---------------------------------------------------------------------------------------
// Building blocks

function wire(...nodes: AudioNode[]): void {
  for (let i = 0; i + 1 < nodes.length; i++) nodes[i].connect(nodes[i + 1]);
}

/** A random factor around 1, for small live variation (pitch, cutoff). */
function vary(k: Kit, amount: number): number {
  return 1 + (k.rand() * 2 - 1) * amount;
}

function track(k: Kit, node: AudioScheduledSourceNode, stopAt: number): void {
  node.stop(stopAt);
  if (stopAt > k.lastStop) {
    k.last = node;
    k.lastStop = stopAt;
  }
}

/** White noise from the shared buffer, from `at` for `dur` seconds, at a random offset. */
function noise(k: Kit, at: number, dur: number): AudioBufferSourceNode {
  const src = k.ctx.createBufferSource();
  src.buffer = k.noise;
  const span = k.noise.duration - dur;
  src.start(at, span > 0 ? k.rand() * span : 0);
  track(k, src, at + dur);
  return src;
}

/** An oscillator from `at` for `dur` seconds, optionally gliding (exponentially) to `to`. */
function tone(k: Kit, wave: Wave, at: number, dur: number, from: number, to = from, glide = 0): OscillatorNode {
  const osc = k.ctx.createOscillator();
  osc.type = wave;
  osc.frequency.value = from;
  osc.frequency.setValueAtTime(from, at);
  if (to !== from && glide > 0) osc.frequency.exponentialRampToValueAtTime(to, at + glide);
  osc.start(at);
  track(k, osc, at + dur);
  return osc;
}

/**
 * A biquad filter, optionally sweeping (exponentially) to `to`.
 * Note: for lowpass and highpass the Web Audio Q is a resonance in dB; for bandpass it is
 * the usual quality factor.
 */
function filter(
  k: Kit,
  type: BiquadFilterType,
  at: number,
  from: number,
  q: number,
  to = from,
  glide = 0,
): BiquadFilterNode {
  const f = k.ctx.createBiquadFilter();
  f.type = type;
  f.Q.value = q;
  f.frequency.value = from;
  f.frequency.setValueAtTime(from, at);
  if (to !== from && glide > 0) f.frequency.exponentialRampToValueAtTime(to, at + glide);
  return f;
}

/** Silent until `at`, linear rise to `peak`, optional hold, exponential decay, then zero. */
function env(k: Kit, at: number, peak: number, attack: number, decay: number, hold = 0): GainNode {
  const g = k.ctx.createGain();
  const p = g.gain;
  p.value = 0;
  p.setValueAtTime(0, at);
  p.linearRampToValueAtTime(peak, at + attack);
  if (hold > 0) p.setValueAtTime(peak, at + attack + hold);
  p.exponentialRampToValueAtTime(FLOOR, at + attack + hold + decay);
  p.setValueAtTime(0, at + attack + hold + decay);
  return g;
}

/** Exponential swell up to `peak` over `rise`, back down over `fall`, then zero. */
function swell(k: Kit, at: number, peak: number, rise: number, fall: number): GainNode {
  const g = k.ctx.createGain();
  const p = g.gain;
  p.value = 0;
  p.setValueAtTime(FLOOR, at);
  p.exponentialRampToValueAtTime(peak, at + rise);
  p.exponentialRampToValueAtTime(FLOOR, at + rise + fall);
  p.setValueAtTime(0, at + rise + fall);
  return g;
}

/** A fixed gain stage (a mix level). */
function level(k: Kit, value: number): GainNode {
  const g = k.ctx.createGain();
  g.gain.value = value;
  return g;
}

/** A low-frequency oscillator scaled by `depth`. Connect the result to an AudioParam. */
function lfo(k: Kit, at: number, dur: number, rate: number, depth: number, wave: Wave = "sine"): GainNode {
  const amount = level(k, depth);
  wire(tone(k, wave, at, dur, rate), amount);
  return amount;
}

// ---------------------------------------------------------------------------------------
// The recipes

/** Gunshot: noise through a lowpass that closes fast, a low sine thump 120 -> 40 Hz, one echo. */
function shot(k: Kit): void {
  const t = k.t;
  const v = vary(k, 0.06);
  // Crack: the bright snap at the muzzle.
  wire(noise(k, t, 0.06), filter(k, "highpass", t, 1500, 0), env(k, t, 0.6, 0.0005, 0.05), k.out);
  // Blast: the punch. Noise through a lowpass that closes from 6.5 kHz to 260 Hz.
  wire(noise(k, t, 0.54), filter(k, "lowpass", t, 6500 * v, 1, 260 * v, 0.32), env(k, t, 1.1, 0.001, 0.5, 0.012), k.out);
  // Body: low-mid weight that small speakers can play.
  wire(noise(k, t, 0.4), filter(k, "bandpass", t, 420 * v, 0.8), env(k, t, 0.9, 0.002, 0.36, 0.01), k.out);
  // Thump: a low sine falling 120 -> 40 Hz, and its octave so small speakers carry it.
  wire(tone(k, "sine", t, 0.34, 120 * v, 40 * v, 0.16), env(k, t, 0.6, 0.002, 0.32), k.out);
  wire(tone(k, "triangle", t, 0.22, 240 * v, 80 * v, 0.12), env(k, t, 0.35, 0.002, 0.2), k.out);
  // Slapback: one darker echo off the far wall.
  const e = t + 0.1 + k.rand() * 0.03;
  wire(noise(k, e, 0.34), filter(k, "lowpass", e, 2400, 0, 420, 0.26), env(k, e, 0.3, 0.004, 0.32), k.out);
  // Room: a soft wash that carries the tail.
  wire(noise(k, t, 0.72), filter(k, "bandpass", t, 900, 0.7), env(k, t + 0.01, 0.12, 0.04, 0.64), k.out);
}

/** Ricochet into the table: a short noise hit, a wooden thunk, a sine whine 2.4 kHz -> 700 Hz. */
function ricochet(k: Kit): void {
  const t = k.t;
  const v = vary(k, 0.05);
  // Impact: a short bright hit.
  wire(noise(k, t, 0.06), filter(k, "bandpass", t, 2800, 0.9), env(k, t, 0.9, 0.0005, 0.05), k.out);
  // Wooden thunk: the bullet bites the table top.
  wire(tone(k, "sine", t, 0.14, 240, 120, 0.06), env(k, t, 0.6, 0.001, 0.12), k.out);
  wire(noise(k, t, 0.1), filter(k, "bandpass", t, 620, 3.5), env(k, t, 2.6, 0.001, 0.09), k.out);
  // Whine: the sweep with a fast wobble, plus a thin metallic partial above it.
  const w = t + 0.012;
  const whine = tone(k, "sine", w, 0.52, 2400 * v, 700 * v, 0.42);
  lfo(k, w, 0.52, 22 + k.rand() * 10, 35).connect(whine.detune);
  wire(whine, env(k, w, 0.3, 0.008, 0.46, 0.04), k.out);
  wire(tone(k, "sine", w, 0.34, 4830 * v, 1410 * v, 0.42), env(k, w, 0.05, 0.008, 0.3), k.out);
}

/** Body fall: a low thud 90 -> 40 Hz with soft lowpassed noise, then the torso lands. */
function fall(k: Kit): void {
  const t = k.t;
  const v = vary(k, 0.05);
  // First contact: knees and hips.
  wire(tone(k, "sine", t, 0.36, 90 * v, 40 * v, 0.22), env(k, t, 1, 0.004, 0.34), k.out);
  wire(tone(k, "triangle", t, 0.2, 180 * v, 80 * v, 0.15), env(k, t, 0.22, 0.004, 0.18), k.out);
  wire(noise(k, t, 0.32), filter(k, "lowpass", t, 520, 0), env(k, t, 1.5, 0.005, 0.3), k.out);
  // The torso lands a beat later, a little softer.
  const b = t + 0.12 + k.rand() * 0.03;
  wire(tone(k, "sine", b, 0.34, 72 * v, 36 * v, 0.2), env(k, b, 0.75, 0.005, 0.32), k.out);
  wire(noise(k, b, 0.3), filter(k, "lowpass", b, 420, 0), env(k, b, 1.1, 0.006, 0.28), k.out);
  // Dust and cloth settle.
  wire(noise(k, b, 0.44), filter(k, "bandpass", b, 2400, 0.8), env(k, b + 0.01, 0.07, 0.02, 0.38), k.out);
}

/** Duck: a quick wooden scrape as the body drops behind the table. */
function duck(k: Kit): void {
  const t = k.t;
  const v = vary(k, 0.08);
  // Scrape: a resonant band of noise sliding down, chopped by stick-slip judder.
  const judder = level(k, 0.55);
  lfo(k, t, 0.24, 38 * v, -0.45, "sawtooth").connect(judder.gain);
  wire(
    noise(k, t, 0.24),
    filter(k, "bandpass", t, 1500 * v, 3, 650 * v, 0.2),
    judder,
    env(k, t, 2.4, 0.012, 0.2, 0.02),
    k.out,
  );
  // Boards: the floor answers low.
  wire(noise(k, t, 0.2), filter(k, "bandpass", t, 340, 2.2), env(k, t, 1.3, 0.01, 0.17), k.out);
  // Knock: a shoulder meets the table edge.
  const n = t + 0.15;
  wire(tone(k, "sine", n, 0.1, 160, 95, 0.05), env(k, n, 0.5, 0.002, 0.08), k.out);
}

/** Card: about 40 ms of highpassed noise, the slap of a card on the table. */
function card(k: Kit): void {
  const t = k.t;
  wire(noise(k, t, 0.065), filter(k, "highpass", t, 1800 * vary(k, 0.1), 0), env(k, t, 0.9, 0.0008, 0.06), k.out);
  // The felt under the card gives a dull tap.
  wire(tone(k, "sine", t, 0.05, 260, 170, 0.04), env(k, t, 0.25, 0.001, 0.04), k.out);
}

/** One metallic click: two inharmonic square blips through a highpass, plus a noise tick. */
function click(k: Kit, at: number, f: number, peak: number, decay: number): void {
  const hp = filter(k, "highpass", at, 1200, 0);
  wire(hp, env(k, at, peak, 0.0005, decay), k.out);
  wire(tone(k, "square", at, decay + 0.01, f), hp);
  wire(tone(k, "square", at, decay + 0.01, f * 1.47), level(k, 0.5), hp);
  wire(noise(k, at, decay), filter(k, "highpass", at, 3500, 0), env(k, at, peak * 0.9, 0.0003, decay * 0.5), k.out);
}

/** Draw: the hammer goes back, then locks. Two short metallic clicks. */
function draw(k: Kit): void {
  const t = k.t;
  const v = vary(k, 0.04);
  click(k, t, 1900 * v, 0.3, 0.022);
  click(k, t + 0.075 + k.rand() * 0.01, 2500 * v, 0.4, 0.03);
}

/** Tick: a 1.5 kHz click of about 20 ms for the last ten seconds. Same every time. */
function tick(k: Kit): void {
  const t = k.t;
  wire(tone(k, "sine", t, 0.035, 1500), env(k, t, 0.6, 0.0006, 0.03), k.out);
  wire(noise(k, t, 0.012), filter(k, "highpass", t, 4000, 0), env(k, t, 0.3, 0.0003, 0.008), k.out);
}

/** [start offset in seconds, frequency in Hz] of each coin ping. */
const PINGS: ReadonlyArray<readonly [number, number]> = [
  [0, 1880],
  [0.055, 2360],
  [0.12, 2080],
  [0.2, 2600],
];

/** Coin: four staggered sine pings between 1.8 and 2.6 kHz, each with a bright partial. */
function coin(k: Kit): void {
  for (const [dt, f0] of PINGS) {
    const at = k.t + dt + k.rand() * 0.008;
    const f = f0 * vary(k, 0.015);
    wire(tone(k, "sine", at, 0.34, f), env(k, at, 0.28, 0.0015, 0.32), k.out);
    wire(tone(k, "sine", at, 0.14, f * 2.76), env(k, at, 0.06, 0.001, 0.12), k.out);
    wire(noise(k, at, 0.012), filter(k, "highpass", at, 6000, 0), env(k, at, 0.2, 0.0003, 0.008), k.out);
  }
}

/** Scatter: a rising swell of dusty noise over a low open fifth. The room empties. */
function scatter(k: Kit): void {
  const t = k.t;
  const rise = 0.72;
  const fall = 0.42;
  const end = rise + fall;
  // Dust: a band of noise that climbs as it swells.
  wire(noise(k, t, end + 0.02), filter(k, "bandpass", t, 320, 1.1, 2600, end), swell(k, t, 1.2, rise, fall), k.out);
  // Wind: a resonant lowpass whistle under the dust.
  wire(
    noise(k, t, end + 0.02),
    filter(k, "lowpass", t, 600, 6, 1500, rise),
    swell(k, t, 0.4, rise * 0.9, fall + rise * 0.1),
    k.out,
  );
  // The low note: D2 and A2 that sag a little as the room empties.
  const lp = filter(k, "lowpass", t, 600, 0);
  wire(lp, env(k, t, 0.5, 0.25, 0.55, 0.32), k.out);
  wire(tone(k, "triangle", t, end + 0.02, 73.4, 69.3, end), lp);
  wire(tone(k, "sine", t, end + 0.02, 110, 103.8, end), level(k, 0.45), lp);
}

// Trims put the kit in a fixed loudness order, measured as the loudest K-weighted 100 ms
// window through the master chain at 48 kHz: shot -13.4 LUFS (it sits at the limiter),
// fall -15.5, ricochet -16, coin -17.5, scatter -18, duck -19.5, card and draw -20.5,
// tick -23. scripts/audio-check.ts asserts the ends of that order (shot loudest, tick softest).
export const RECIPES: Readonly<Record<Sfx, Recipe>> = {
  shot: { length: 0.75, gain: 1, build: shot },
  ricochet: { length: 0.55, gain: 0.66, build: ricochet },
  fall: { length: 0.6, gain: 0.78, build: fall },
  duck: { length: 0.26, gain: 1.25, build: duck },
  card: { length: 0.07, gain: 0.8, build: card },
  draw: { length: 0.13, gain: 1.1, build: draw },
  tick: { length: 0.04, gain: 1.1, build: tick },
  coin: { length: 0.56, gain: 0.85, build: coin },
  scatter: { length: 1.18, gain: 0.52, build: scatter },
};

// ---------------------------------------------------------------------------------------
// Shared plumbing

export interface Scheduled {
  /** The source that stops last (null only if a recipe made no sources). */
  readonly last: AudioScheduledSourceNode | null;
  /** Context time when the sound is over. */
  readonly end: number;
}

/** Schedules sound `s` to start at context time `t`, into `out`. */
export function schedule(ctx: BaseAudioContext, out: AudioNode, s: Sfx, t: number, rand: () => number): Scheduled {
  const recipe = RECIPES[s];
  let bus = out;
  if (recipe.gain !== 1) {
    const trim = ctx.createGain();
    trim.gain.value = recipe.gain;
    trim.connect(out);
    bus = trim;
  }
  const k: Kit = { ctx, t, out: bus, rand, noise: noiseBuffer(ctx), last: null, lastStop: Number.NEGATIVE_INFINITY };
  recipe.build(k);
  return { last: k.last, end: t + recipe.length };
}

/**
 * The master bus: input gain, a compressor that glues overlapping sounds, then a soft
 * limiter (wave shaper). The shaper clamps its input to [-1, 1] and its curve tops out
 * at about 0.92, so no output sample can reach 1.0. Returns the input node.
 */
export function buildMaster(ctx: BaseAudioContext, gain: number): GainNode {
  const input = ctx.createGain();
  input.gain.value = gain;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -8;
  comp.knee.value = 6;
  comp.ratio.value = 4;
  comp.attack.value = 0.003;
  comp.release.value = 0.15;
  const limit = ctx.createWaveShaper();
  limit.curve = limiterCurve();
  wire(input, comp, limit, ctx.destination);
  return input;
}

const noiseBuffers = new WeakMap<BaseAudioContext, AudioBuffer>();

/** One buffer of seeded white noise per context. */
function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  let buf = noiseBuffers.get(ctx);
  if (!buf) {
    const n = Math.ceil(ctx.sampleRate * NOISE_SECONDS);
    buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const data = buf.getChannelData(0);
    const rand = seeded(0x5eed);
    for (let i = 0; i < n; i++) data[i] = rand() * 2 - 1;
    noiseBuffers.set(ctx, buf);
  }
  return buf;
}

let limiter: Float32Array<ArrayBuffer> | null = null;

/** Linear up to 0.7, then a tanh knee toward 0.98. At input 1.0 the output is about 0.92. */
function limiterCurve(): Float32Array<ArrayBuffer> {
  if (limiter) return limiter;
  const n = 2049; // odd, so input 0 maps exactly to output 0
  const knee = 0.7;
  const ceiling = 0.98;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const a = Math.abs(x);
    const y = a <= knee ? a : knee + (ceiling - knee) * Math.tanh((a - knee) / (ceiling - knee));
    curve[i] = Math.sign(x) * y;
  }
  limiter = curve;
  return curve;
}

/** mulberry32: a small, fast, seeded generator of uniform numbers in [0, 1). */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a hash of a name, used to seed offline renders so they are reproducible. */
export function hashName(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
