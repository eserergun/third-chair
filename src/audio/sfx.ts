// Third Chair sound kit: tiny synthesized effects on the Web Audio API. No audio files.
//
// Sound is off until the player turns it on. The choice is stored in localStorage under
// "standoff.sound" ("on" or "off") and shared live between tabs. Browsers start audio only
// after a user gesture, so call unlock() from a click or key handler (setMuted(false) does
// it too). play() is safe to call at any time: it does nothing while muted, locked, or
// unsupported, and it never throws.
//
// React: useSyncExternalStore(subscribe, isMuted) or useSyncExternalStore(subscribe, status).

import { RECIPES, buildMaster, hashName, schedule, seeded } from "./recipes";

export type Sfx = "shot" | "ricochet" | "fall" | "duck" | "card" | "draw" | "tick" | "coin" | "scatter";

/** Every sound, in a stable order. */
export const SFX: readonly Sfx[] = ["shot", "ricochet", "fall", "duck", "card", "draw", "tick", "coin", "scatter"];

export interface PlayOptions {
  /** Stereo position from -1 (left) to 1 (right). Default 0. */
  pan?: number;
  /** Seconds to wait before the sound starts, 0 to 10. Default 0. */
  delay?: number;
  /** Loudness from 0 to 1. Default 1. */
  volume?: number;
}

/**
 * unsupported  this browser has no Web Audio
 * muted        the player has not turned sound on
 * locked       sound is on, but the browser waits for a click or key press (call unlock())
 * ready        sounds play
 */
export type SoundStatus = "unsupported" | "muted" | "locked" | "ready";

const STORAGE_KEY = "standoff.sound";
/** Master gain into the compressor. */
const LEVEL = 0.7;
/** Schedule this far ahead so the first attack ramp is never cut short. */
const LEAD = 0.005;
/** Extra seconds rendered offline after a sound's length (compressor lookahead and margin). */
const TAIL = 0.06;
/**
 * A cold compressor ducks its first ~100 ms of input. Offline renders start with this much
 * silence, which is cut from the result; live sounds never start before WARMUP on a new
 * context's clock.
 */
const PREROLL = 0.25;
const WARMUP = 0.12;
const MAX_VOICES = 24;
/** play() may schedule on a suspended context this long after a resume request. */
const RESUME_GRACE_MS = 1000;
/** After muting, suspend the context so no idle audio thread keeps running. */
const SUSPEND_AFTER_MS = 400;
/** Time constant of the master fade on mute and unmute (seconds). */
const FADE = 0.015;

type AudioContextCtor = new (options?: AudioContextOptions) => AudioContext;
type OfflineAudioContextCtor = new (channels: number, length: number, sampleRate: number) => OfflineAudioContext;

let muted: boolean | null = null; // null until read from storage
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let resumedAt = Number.NEGATIVE_INFINITY;
let suspendTimer: ReturnType<typeof setTimeout> | null = null;
let voices = 0;
/** Voices scheduled while the context was still resuming. Stale ones are dropped on resume. */
let waiting: Array<{ at: number; drop: () => void }> = [];
const listeners = new Set<() => void>();
let watching = false;

const noop = (): void => {};
const has = (s: unknown): s is Sfx => typeof s === "string" && Object.prototype.hasOwnProperty.call(RECIPES, s);

function clock(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

// ---------------------------------------------------------------------------------------
// Storage (every access guarded: private mode and blocked storage throw)

function storage(): Storage | null {
  try {
    return (globalThis as { localStorage?: Storage }).localStorage ?? null;
  } catch {
    return null;
  }
}

function readMuted(): boolean {
  try {
    return storage()?.getItem(STORAGE_KEY) !== "on";
  } catch {
    return true;
  }
}

function writeMuted(m: boolean): void {
  try {
    storage()?.setItem(STORAGE_KEY, m ? "off" : "on");
  } catch {
    // Blocked or full storage: the choice still holds in memory for this page.
  }
}

/** Follow the toggle from other tabs. */
function watch(): void {
  if (watching) return;
  watching = true;
  try {
    if (typeof globalThis.addEventListener !== "function") return;
    globalThis.addEventListener("storage", (e: StorageEvent) => {
      if (e.key !== null && e.key !== STORAGE_KEY) return;
      const next = readMuted();
      if (next === muted) return;
      muted = next;
      apply();
      notify();
    });
  } catch {
    // No window here.
  }
}

function notify(): void {
  for (const listener of Array.from(listeners)) {
    try {
      listener();
    } catch {
      // A broken listener must not stop the others.
    }
  }
}

// ---------------------------------------------------------------------------------------
// Context

function audioCtor(): AudioContextCtor | null {
  try {
    const g = globalThis as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor };
    return g.AudioContext ?? g.webkitAudioContext ?? null;
  } catch {
    return null;
  }
}

function offlineCtor(): OfflineAudioContextCtor | null {
  try {
    const g = globalThis as unknown as {
      OfflineAudioContext?: OfflineAudioContextCtor;
      webkitOfflineAudioContext?: OfflineAudioContextCtor;
    };
    return g.OfflineAudioContext ?? g.webkitOfflineAudioContext ?? null;
  } catch {
    return null;
  }
}

/** False only when the browser reports that this page never had a user gesture. */
function activated(): boolean {
  try {
    const nav = globalThis.navigator as unknown as { userActivation?: { hasBeenActive?: boolean } } | undefined;
    return nav?.userActivation?.hasBeenActive !== false;
  } catch {
    return true;
  }
}

/** Mix with other audio (music apps) on Safari instead of taking over the audio session. */
function ambient(): void {
  try {
    const nav = globalThis.navigator as unknown as { audioSession?: { type: string } } | undefined;
    const session = nav?.audioSession;
    if (session && session.type === "auto") session.type = "ambient";
  } catch {
    // Not supported.
  }
}

function open(): AudioContext | null {
  const Ctor = audioCtor();
  if (!Ctor) return null;
  let c: AudioContext;
  try {
    c = new Ctor({ latencyHint: "interactive" });
  } catch {
    return null;
  }
  try {
    master = buildMaster(c, muted === false ? LEVEL : 0);
  } catch {
    master = null;
    void c.close().catch(noop);
    return null;
  }
  c.onstatechange = onState;
  ambient();
  return c;
}

function onState(): void {
  try {
    if (ctx && ctx.state === "running" && waiting.length > 0) {
      const now = clock();
      const stale = waiting.filter((w) => now - w.at > RESUME_GRACE_MS);
      waiting = [];
      for (const w of stale) w.drop();
    }
  } catch {
    // Keep going.
  }
  notify();
}

/** Older iOS unlocks only after a source starts inside the gesture: play one silent sample. */
function prime(c: AudioContext): void {
  try {
    const src = c.createBufferSource();
    src.buffer = c.createBuffer(1, 1, c.sampleRate);
    src.connect(c.destination);
    src.onended = () => {
      try {
        src.disconnect();
      } catch {
        // Already gone.
      }
    };
    src.start(0);
  } catch {
    // Not needed in modern browsers.
  }
}

function fade(target: number): void {
  if (!ctx || !master) return;
  try {
    const g = master.gain;
    const now = ctx.currentTime;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.setTargetAtTime(target, now, FADE);
  } catch {
    // Ignore.
  }
}

/** Bring the audio graph in line with the mute flag. */
function apply(): void {
  if (muted) {
    fade(0);
    if (suspendTimer === null && ctx) {
      suspendTimer = setTimeout(() => {
        suspendTimer = null;
        try {
          if (muted && ctx && ctx.state === "running") void ctx.suspend().catch(noop);
        } catch {
          // Ignore.
        }
      }, SUSPEND_AFTER_MS);
    }
  } else {
    if (suspendTimer !== null) {
      clearTimeout(suspendTimer);
      suspendTimer = null;
    }
    unlock();
    fade(LEVEL);
  }
}

// ---------------------------------------------------------------------------------------
// Public API

/** True until the player turns sound on. Remembered in localStorage "standoff.sound". */
export function isMuted(): boolean {
  if (muted === null) {
    muted = readMuted();
    watch();
  }
  return muted;
}

/**
 * Turn sound off (true) or on (false) and remember it. Call it from the click that flips
 * the toggle: turning sound on also unlocks audio.
 */
export function setMuted(m: boolean): void {
  try {
    if (typeof m !== "boolean") return; // untyped callers: ignore, never guess
    const before = isMuted();
    muted = m;
    writeMuted(m);
    apply();
    if (before !== m) notify();
  } catch {
    // Never throws.
  }
}

/**
 * Create or resume the AudioContext. Call it from a user gesture (click, key, touch).
 * Cheap and safe to call on every gesture. While muted it does nothing, so a muted page
 * never opens an audio device.
 */
export function unlock(): void {
  try {
    if (isMuted()) return;
    if (ctx && ctx.state === "closed") {
      ctx = null;
      master = null;
    }
    if (!ctx) {
      if (!activated()) return;
      ctx = open();
      if (!ctx) return;
      // Inside a gesture the context starts "running" and fires no statechange: tell
      // subscribers that status() moved from "locked" to "ready".
      notify();
    }
    if (ctx.state !== "running") {
      resumedAt = clock();
      void Promise.resolve(ctx.resume()).catch(noop);
      prime(ctx);
    }
  } catch {
    // Never throws.
  }
}

/** Play a sound now, or after `delay` seconds. No-op while muted, locked, or unsupported. */
export function play(s: Sfx, opts?: PlayOptions): void {
  try {
    if (isMuted() || !ctx || !master || !has(s)) return;
    const c = ctx;
    const out = master;
    const running = c.state === "running";
    // A suspended context counts as unlocked only right after a resume request.
    if (!running && (c.state === "closed" || clock() - resumedAt > RESUME_GRACE_MS)) return;
    if (voices >= MAX_VOICES) return;

    const volume = clamp(num(opts?.volume, 1), 0, 1);
    if (volume === 0) return;
    const pan = clamp(num(opts?.pan, 0), -1, 1);
    const delay = clamp(num(opts?.delay, 0), 0, 10);

    const bus = c.createGain();
    let panner: StereoPannerNode | null = null;
    if (pan !== 0 && typeof c.createStereoPanner === "function") {
      panner = c.createStereoPanner();
      panner.pan.value = pan;
      // Equal-power panning drops the center by 3 dB. Lift it back so loudness stays even.
      bus.gain.value = volume * Math.SQRT2;
      bus.connect(panner);
      panner.connect(out);
    } else {
      bus.gain.value = volume;
      bus.connect(out);
    }

    const start = Math.max(c.currentTime + LEAD, WARMUP) + delay;
    const { last } = schedule(c, bus, s, start, Math.random);
    voices++;
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      voices--;
      try {
        bus.disconnect();
        panner?.disconnect();
      } catch {
        // Already disconnected.
      }
    };
    if (last) last.onended = finish;
    else finish();
    if (!running) waiting.push({ at: clock(), drop: finish });
  } catch {
    // Never throws.
  }
}

/** Where sound stands right now. See SoundStatus. */
export function status(): SoundStatus {
  if (!audioCtor()) return "unsupported";
  if (isMuted()) return "muted";
  return ctx !== null && ctx.state === "running" ? "ready" : "locked";
}

/** Call `listener` when the mute flag or the audio state changes. Returns an unsubscribe. */
export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  isMuted(); // starts the cross-tab watch
  return () => {
    listeners.delete(listener);
  };
}

/** Length of a sound in seconds (0 for an unknown name). Handy to time animations. */
export function duration(s: Sfx): number {
  return has(s) ? RECIPES[s].length : 0;
}

/**
 * Render a sound with an OfflineAudioContext through the same master chain as live play,
 * with the compressor already settled. Mono. The sound starts at sample 0 and the result
 * is duration(s) + 0.06 s long. Seeded, so renders repeat (up to float rounding in the
 * browser's DSP). Ignores mute. For tests.
 */
export function renderOffline(s: Sfx, sampleRate = 44100): Promise<Float32Array> {
  try {
    const Ctor = offlineCtor();
    if (!Ctor) return Promise.reject(new Error("OfflineAudioContext is not available here."));
    if (!has(s)) return Promise.reject(new Error(`Unknown sound: ${String(s)}`));
    if (!Number.isFinite(sampleRate) || sampleRate < 3000 || sampleRate > 384000) {
      return Promise.reject(new RangeError(`Sample rate out of range: ${sampleRate}`));
    }
    const skip = Math.round(PREROLL * sampleRate);
    const keep = Math.ceil((RECIPES[s].length + TAIL) * sampleRate);
    const off = new Ctor(1, skip + keep, sampleRate);
    schedule(off, buildMaster(off, LEVEL), s, skip / sampleRate, seeded(hashName(s)));
    return off.startRendering().then((buffer) => buffer.getChannelData(0).slice(skip));
  } catch (e) {
    return Promise.reject(e instanceof Error ? e : new Error(String(e)));
  }
}

// Vite dev: close the old context when this module is hot-replaced.
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    try {
      void ctx?.close().catch(noop);
    } catch {
      // Ignore.
    }
  });
}
