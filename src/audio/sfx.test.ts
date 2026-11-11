// Unit tests for the sound kit, in Node. A strict fake of the Web Audio graph checks every
// recipe's automation and the runtime rules (mute, lock, voice cap, pan, delay, storage).
// The real browser path is covered by scripts/audio-check.ts.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GATE, analyze, peakLoudness, problems } from "./analyze";
import { RECIPES, schedule, seeded } from "./recipes";
import { SFX } from "./sfx";

// ---------------------------------------------------------------------------------------
// A strict fake of the parts of Web Audio the kit uses.

interface Automation {
  readonly kind: "set" | "linear" | "exponential" | "target";
  readonly v: number;
  readonly t: number;
}

class FakeParam {
  value: number;
  readonly owner: FakeNode;
  events: Automation[] = [];
  constructor(owner: FakeNode, value: number) {
    this.owner = owner;
    this.value = value;
  }
  private add(kind: Automation["kind"], v: number, t: number): this {
    if (!Number.isFinite(v)) throw new TypeError(`non-finite value ${v}`);
    if (!Number.isFinite(t) || t < 0) throw new RangeError(`bad time ${t}`);
    const prev = this.events[this.events.length - 1];
    if (prev && t < prev.t) throw new Error(`automation goes back in time: ${t} after ${prev.t}`);
    this.events.push({ kind, v, t });
    return this;
  }
  setValueAtTime(v: number, t: number): this {
    return this.add("set", v, t);
  }
  linearRampToValueAtTime(v: number, t: number): this {
    return this.add("linear", v, t);
  }
  exponentialRampToValueAtTime(v: number, t: number): this {
    if (v === 0) throw new RangeError("exponential ramp to zero");
    const prev = this.events.length > 0 ? this.events[this.events.length - 1].v : this.value;
    // Real browsers do not throw here: the ramp silently holds its start value. Treat it as a bug.
    if (prev === 0 || Math.sign(prev) !== Math.sign(v)) throw new Error(`exponential ramp from ${prev} to ${v}`);
    return this.add("exponential", v, t);
  }
  setTargetAtTime(v: number, t: number, timeConstant: number): this {
    if (!(timeConstant > 0)) throw new RangeError("time constant must be positive");
    return this.add("target", v, t);
  }
  cancelScheduledValues(t: number): this {
    this.events = this.events.filter((e) => e.t < t);
    return this;
  }
}

class FakeNode {
  readonly context: FakeContext;
  outputs: Array<FakeNode | FakeParam> = [];
  constructor(context: FakeContext) {
    this.context = context;
    context.nodes.push(this);
  }
  connect<T extends FakeNode | FakeParam>(dest: T): T {
    const d: FakeNode | FakeParam = dest;
    const target = d instanceof FakeParam ? d.owner : d;
    if (target.context !== this.context) throw new Error("connect across contexts");
    this.outputs.push(dest);
    return dest;
  }
  disconnect(): void {
    this.outputs = [];
  }
}

class FakeGain extends FakeNode {
  readonly gain = new FakeParam(this, 1);
}

class FakeBiquad extends FakeNode {
  type = "lowpass";
  readonly frequency = new FakeParam(this, 350);
  readonly Q = new FakeParam(this, 1);
}

class FakeCompressor extends FakeNode {
  readonly threshold = new FakeParam(this, -24);
  readonly knee = new FakeParam(this, 30);
  readonly ratio = new FakeParam(this, 12);
  readonly attack = new FakeParam(this, 0.003);
  readonly release = new FakeParam(this, 0.25);
}

class FakeShaper extends FakeNode {
  curve: Float32Array | null = null;
}

class FakePanner extends FakeNode {
  readonly pan = new FakeParam(this, 0);
}

class FakeBuffer {
  readonly length: number;
  readonly sampleRate: number;
  private readonly data: Float32Array[];
  constructor(channels: number, length: number, sampleRate: number) {
    this.length = length;
    this.sampleRate = sampleRate;
    this.data = Array.from({ length: channels }, () => new Float32Array(length));
  }
  get duration(): number {
    return this.length / this.sampleRate;
  }
  getChannelData(i: number): Float32Array {
    return this.data[i];
  }
}

class FakeSource extends FakeNode {
  startAt: number | null = null;
  stopAt: number | null = null;
  onended: (() => void) | null = null;
  start(when = 0, offset = 0): void {
    if (this.startAt !== null) throw new Error("started twice");
    if (!(when >= 0) || !(offset >= 0)) throw new RangeError("bad start");
    this.startAt = when;
  }
  stop(when = 0): void {
    if (this.startAt === null) throw new Error("stop before start");
    if (!(when >= 0)) throw new RangeError("bad stop");
    this.stopAt = when;
  }
}

class FakeOscillator extends FakeSource {
  type = "sine";
  readonly frequency = new FakeParam(this, 440);
  readonly detune = new FakeParam(this, 0);
}

class FakeBufferSource extends FakeSource {
  buffer: FakeBuffer | null = null;
}

class FakeContext {
  static created: FakeContext[] = [];
  static startState: "running" | "suspended" = "running";
  static autoResume = true;
  readonly nodes: FakeNode[] = [];
  readonly destination: FakeNode;
  readonly sampleRate = 48000;
  currentTime = 0;
  state: "running" | "suspended" | "closed";
  onstatechange: (() => void) | null = null;
  constructor() {
    this.destination = new FakeNode(this);
    this.state = FakeContext.startState;
    FakeContext.created.push(this);
  }
  private become(state: "running" | "suspended" | "closed"): void {
    this.state = state;
    queueMicrotask(() => this.onstatechange?.());
  }
  /** Finish a resume that autoResume = false left hanging. */
  finishResume(): void {
    this.become("running");
  }
  resume(): Promise<void> {
    if (FakeContext.autoResume) this.become("running");
    return Promise.resolve();
  }
  suspend(): Promise<void> {
    this.become("suspended");
    return Promise.resolve();
  }
  close(): Promise<void> {
    this.become("closed");
    return Promise.resolve();
  }
  createGain(): FakeGain {
    return new FakeGain(this);
  }
  createBiquadFilter(): FakeBiquad {
    return new FakeBiquad(this);
  }
  createOscillator(): FakeOscillator {
    return new FakeOscillator(this);
  }
  createBufferSource(): FakeBufferSource {
    return new FakeBufferSource(this);
  }
  createBuffer(channels: number, length: number, rate: number): FakeBuffer {
    return new FakeBuffer(channels, length, rate);
  }
  createDynamicsCompressor(): FakeCompressor {
    return new FakeCompressor(this);
  }
  createWaveShaper(): FakeShaper {
    return new FakeShaper(this);
  }
  createStereoPanner(): FakePanner {
    return new FakePanner(this);
  }
  sources(): FakeSource[] {
    return this.nodes.filter((n): n is FakeSource => n instanceof FakeSource);
  }
  /** The master input: the gain that feeds the compressor. */
  master(): FakeGain {
    const m = this.nodes.find((n) => n instanceof FakeGain && n.outputs.some((o) => o instanceof FakeCompressor));
    if (!(m instanceof FakeGain)) throw new Error("no master chain");
    return m;
  }
  /** Voice buses still wired to the master (directly or through a panner). */
  voices(): number {
    const master = this.master();
    return this.nodes.filter(
      (n) =>
        n instanceof FakeGain &&
        n !== master &&
        n.outputs.some((o) => o === master || (o instanceof FakePanner && o.outputs.includes(master))),
    ).length;
  }
}

/** True if `from` feeds `to`, directly or through the AudioParam of a node that does. */
function reaches(from: FakeNode, to: FakeNode): boolean {
  const seen = new Set<FakeNode>();
  const queue: FakeNode[] = [from];
  while (queue.length > 0) {
    const n = queue.shift() as FakeNode;
    if (n === to) return true;
    if (seen.has(n)) continue;
    seen.add(n);
    for (const o of n.outputs) queue.push(o instanceof FakeParam ? o.owner : o);
  }
  return false;
}

function memoryStorage(seed: Record<string, string> = {}): Storage {
  const m = new Map<string, string>(Object.entries(seed));
  const s = {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => {
      m.set(k, String(v));
    },
    removeItem: (k: string) => {
      m.delete(k);
    },
    clear: () => m.clear(),
    key: (i: number) => Array.from(m.keys())[i] ?? null,
    get length() {
      return m.size;
    },
  };
  return s as unknown as Storage;
}

async function load(): Promise<typeof import("./sfx")> {
  vi.resetModules();
  return import("./sfx");
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

// ---------------------------------------------------------------------------------------

describe("recipes", () => {
  it("cover all nine sounds, each under 1.5 s", () => {
    expect(SFX).toHaveLength(9);
    expect(new Set(SFX).size).toBe(9);
    for (const s of SFX) {
      expect(RECIPES[s].length).toBeGreaterThan(0);
      expect(RECIPES[s].length).toBeLessThan(1.5);
      expect(RECIPES[s].gain).toBeGreaterThan(0);
    }
  });

  for (const s of SFX) {
    it(`${s}: valid automation, every source stops within its length, every layer reaches the bus`, () => {
      const ctx = new FakeContext();
      const out = ctx.createGain();
      const t0 = 2;
      const { last, end } = schedule(ctx as unknown as BaseAudioContext, out as unknown as AudioNode, s, t0, seeded(7));
      expect(end).toBeCloseTo(t0 + RECIPES[s].length, 9);
      const sources = ctx.sources();
      expect(sources.length).toBeGreaterThan(0);
      for (const src of sources) {
        expect(src.startAt).not.toBeNull();
        expect(src.stopAt).not.toBeNull();
        expect(src.startAt as number).toBeGreaterThanOrEqual(t0);
        expect(src.stopAt as number).toBeGreaterThan(src.startAt as number);
        expect(src.stopAt as number).toBeLessThanOrEqual(end + 1e-9);
        expect(reaches(src, out)).toBe(true);
      }
      const latest = Math.max(...sources.map((x) => x.stopAt as number));
      expect((last as unknown as FakeSource).stopAt).toBe(latest);
      // Every envelope closes at zero before the sound is over.
      for (const n of ctx.nodes) {
        if (!(n instanceof FakeGain) || n.gain.events.length === 0) continue;
        const final = n.gain.events[n.gain.events.length - 1];
        expect(final.v).toBe(0);
        expect(final.t).toBeLessThanOrEqual(end + 1e-9);
      }
    });
  }

  it("are reproducible with the same seed", () => {
    const freqs = (): number[] => {
      const ctx = new FakeContext();
      schedule(ctx as unknown as BaseAudioContext, ctx.createGain() as unknown as AudioNode, "coin", 0, seeded(42));
      return ctx.nodes.flatMap((n) => (n instanceof FakeOscillator ? n.frequency.events.map((e) => e.v) : []));
    };
    expect(freqs()).toEqual(freqs());
  });
});

describe("sfx without Web Audio (Node)", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", memoryStorage());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("starts muted and remembers the choice", async () => {
    const storage = memoryStorage();
    vi.stubGlobal("localStorage", storage);
    let sfx = await load();
    expect(sfx.isMuted()).toBe(true);
    sfx.setMuted(false);
    expect(sfx.isMuted()).toBe(false);
    expect(storage.getItem("standoff.sound")).toBe("on");
    sfx = await load();
    expect(sfx.isMuted()).toBe(false);
    sfx.setMuted(true);
    expect(storage.getItem("standoff.sound")).toBe("off");
  });

  it("reports unsupported and never throws", async () => {
    const sfx = await load();
    expect(sfx.status()).toBe("unsupported");
    expect(() => {
      sfx.unlock();
      sfx.setMuted(false);
      sfx.play("shot");
      sfx.play("nope" as never);
      sfx.play(undefined as never, { pan: Number.NaN, delay: -1 });
      sfx.setMuted(undefined as never);
    }).not.toThrow();
    expect(sfx.isMuted()).toBe(false); // setMuted(undefined) was ignored
  });

  it("survives storage that throws on every call", async () => {
    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    vi.stubGlobal("localStorage", blocked);
    const sfx = await load();
    expect(sfx.isMuted()).toBe(true);
    expect(() => sfx.setMuted(false)).not.toThrow();
    expect(sfx.isMuted()).toBe(false);
  });

  it("survives a localStorage getter that throws", async () => {
    vi.unstubAllGlobals();
    const before = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new Error("SecurityError");
      },
    });
    try {
      const sfx = await load();
      expect(sfx.isMuted()).toBe(true);
      sfx.setMuted(false);
      expect(sfx.isMuted()).toBe(false);
    } finally {
      if (before) Object.defineProperty(globalThis, "localStorage", before);
      else Reflect.deleteProperty(globalThis, "localStorage");
    }
  });

  it("notifies subscribers on change until they unsubscribe", async () => {
    const sfx = await load();
    const seen: boolean[] = [];
    const off = sfx.subscribe(() => seen.push(sfx.isMuted()));
    sfx.setMuted(false);
    sfx.setMuted(false); // no change, no call
    sfx.setMuted(true);
    off();
    sfx.setMuted(false);
    expect(seen).toEqual([false, true]);
  });

  it("gives durations for timing and 0 for unknown names", async () => {
    const sfx = await load();
    for (const s of SFX) expect(sfx.duration(s)).toBe(RECIPES[s].length);
    expect(sfx.duration("nope" as never)).toBe(0);
  });

  it("renderOffline rejects (does not throw) without OfflineAudioContext", async () => {
    const sfx = await load();
    await expect(sfx.renderOffline("shot")).rejects.toThrow(/OfflineAudioContext/);
  });

  it("renderOffline rejects unknown sounds and bad sample rates", async () => {
    vi.stubGlobal("OfflineAudioContext", class {});
    const sfx = await load();
    await expect(sfx.renderOffline("nope" as never)).rejects.toThrow(/Unknown sound/);
    await expect(sfx.renderOffline("shot", Number.NaN)).rejects.toThrow(RangeError);
    await expect(sfx.renderOffline("shot", 100)).rejects.toThrow(RangeError);
  });
});

describe("sfx with a fake AudioContext", () => {
  beforeEach(() => {
    FakeContext.created = [];
    FakeContext.startState = "running";
    FakeContext.autoResume = true;
    vi.stubGlobal("localStorage", memoryStorage());
    vi.stubGlobal("AudioContext", FakeContext);
    vi.stubGlobal("navigator", { userActivation: { hasBeenActive: true } });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("does nothing while muted: no context, no sound", async () => {
    const sfx = await load();
    sfx.unlock();
    sfx.play("shot");
    expect(FakeContext.created).toHaveLength(0);
    expect(sfx.status()).toBe("muted");
  });

  it("turning sound on opens one context; play() goes through compressor and limiter", async () => {
    const sfx = await load();
    sfx.setMuted(false);
    sfx.unlock();
    expect(FakeContext.created).toHaveLength(1);
    expect(sfx.status()).toBe("ready");
    const ctx = FakeContext.created[0];
    sfx.play("coin");
    expect(ctx.voices()).toBe(1);
    const limiter = ctx.nodes.find((n) => n instanceof FakeShaper);
    expect(limiter).toBeInstanceOf(FakeShaper);
    expect((limiter as FakeShaper).outputs).toContain(ctx.destination);
    expect((limiter as FakeShaper).curve?.length).toBeGreaterThan(1000);
    for (const src of ctx.sources()) expect(reaches(src, ctx.destination)).toBe(true);
  });

  it("tells subscribers when the first gesture opens a running context", async () => {
    vi.stubGlobal("localStorage", memoryStorage({ "standoff.sound": "on" }));
    const sfx = await load();
    const seen: string[] = [];
    sfx.subscribe(() => seen.push(sfx.status()));
    expect(sfx.status()).toBe("locked");
    sfx.unlock();
    expect(seen).toContain("ready");
  });

  it("waits for a gesture when the page never had one", async () => {
    vi.stubGlobal("navigator", { userActivation: { hasBeenActive: false } });
    vi.stubGlobal("localStorage", memoryStorage({ "standoff.sound": "on" }));
    const sfx = await load();
    expect(sfx.status()).toBe("locked");
    sfx.unlock();
    sfx.play("shot");
    expect(FakeContext.created).toHaveLength(0);
  });

  it("caps live voices at 24 and frees them when they end", async () => {
    const sfx = await load();
    sfx.setMuted(false);
    const ctx = FakeContext.created[0];
    for (let i = 0; i < 100; i++) sfx.play("tick");
    expect(ctx.voices()).toBe(24);
    for (const src of ctx.sources()) src.onended?.();
    expect(ctx.voices()).toBe(0);
    sfx.play("tick");
    expect(ctx.voices()).toBe(1);
  });

  it("pans with equal power and keeps loudness even", async () => {
    const sfx = await load();
    sfx.setMuted(false);
    const ctx = FakeContext.created[0];
    sfx.play("shot", { pan: -1, volume: 0.5 });
    const panner = ctx.nodes.find((n) => n instanceof FakePanner) as FakePanner;
    expect(panner.pan.value).toBe(-1);
    const bus = ctx.nodes.find((n) => n instanceof FakeGain && n.outputs.includes(panner)) as FakeGain;
    expect(bus.gain.value).toBeCloseTo(0.5 * Math.SQRT2, 9);
    sfx.play("shot", { pan: 5 }); // clamped to 1
    expect(ctx.nodes.filter((n) => n instanceof FakePanner).map((n) => (n as FakePanner).pan.value)).toEqual([-1, 1]);
  });

  it("starts after the delay, and never inside a new context's warm-up", async () => {
    const sfx = await load();
    sfx.setMuted(false);
    const ctx = FakeContext.created[0];
    sfx.play("card");
    const first = Math.min(...ctx.sources().map((s) => s.startAt as number));
    expect(first).toBeCloseTo(0.12, 9);
    ctx.currentTime = 5;
    const before = ctx.sources().length;
    sfx.play("card", { delay: 0.5 });
    const later = ctx.sources().slice(before);
    expect(Math.min(...later.map((s) => s.startAt as number))).toBeCloseTo(5.505, 9);
    sfx.play("card", { delay: 99 }); // clamped to 10 s
    expect(Math.max(...ctx.sources().map((s) => s.startAt as number))).toBeLessThanOrEqual(15.006);
  });

  it("mute fades out, then suspends; unmute resumes and fades in", async () => {
    vi.useFakeTimers();
    const sfx = await load();
    sfx.setMuted(false);
    const ctx = FakeContext.created[0];
    sfx.setMuted(true);
    const fadeOut = ctx.master().gain.events.at(-1);
    expect(fadeOut).toMatchObject({ kind: "target", v: 0 });
    vi.advanceTimersByTime(500);
    expect(ctx.state).toBe("suspended");
    sfx.play("shot");
    expect(ctx.voices()).toBe(0);
    sfx.setMuted(false);
    expect(ctx.state).toBe("running");
    expect(ctx.master().gain.events.at(-1)).toMatchObject({ kind: "target", v: 0.7 });
  });

  it("drops sounds that waited too long for a slow resume", async () => {
    FakeContext.startState = "suspended";
    FakeContext.autoResume = false;
    let now = 1000;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const sfx = await load();
    sfx.setMuted(false);
    const ctx = FakeContext.created[0];
    expect(sfx.status()).toBe("locked");
    sfx.play("shot"); // right after the resume request: queued
    expect(ctx.voices()).toBe(1);
    now += 2000; // the resume is taking too long
    sfx.play("coin"); // outside the grace window: ignored
    expect(ctx.voices()).toBe(1);
    ctx.finishResume();
    await flush();
    expect(sfx.status()).toBe("ready");
    expect(ctx.voices()).toBe(0); // the stale shot was dropped
    sfx.play("coin");
    expect(ctx.voices()).toBe(1);
  });

  it("keeps sounds asked for during a quick resume", async () => {
    FakeContext.startState = "suspended";
    FakeContext.autoResume = false;
    const sfx = await load();
    sfx.setMuted(false);
    const ctx = FakeContext.created[0];
    sfx.play("card");
    ctx.finishResume();
    await flush();
    expect(ctx.voices()).toBe(1);
  });
});

describe("analyze", () => {
  const rate = 48000;
  const sine = (seconds: number, amp: number, hz = 997): Float32Array => {
    const x = new Float32Array(Math.round(seconds * rate));
    for (let i = 0; i < x.length; i++) x[i] = amp * Math.sin((2 * Math.PI * hz * i) / rate);
    return x;
  };

  it("measures a steady sine", () => {
    const s = analyze(sine(1, 0.5), rate);
    expect(s.rms).toBeCloseTo(0.5 / Math.SQRT2, 3);
    expect(s.peak).toBeCloseTo(0.5, 3);
    expect(s.onset).toBeLessThan(0.001); // sample 0 of a sine is 0; sample 1 is above the gate
    expect(s.audible).toBeCloseTo(1, 3);
    expect(s.finite).toBe(true);
    // BS.1770: a full-scale 997 Hz sine in one channel reads -3.01 LUFS.
    expect(s.loudness).toBeCloseTo(-3.01 + 20 * Math.log10(0.5), 1);
    expect(problems(s)).toEqual([expect.stringMatching(/cut off/)]);
  });

  it("finds onset, end and a quiet tail", () => {
    const x = new Float32Array(rate / 2);
    x.set(sine(0.1, 0.3), rate / 10); // 0.1 s burst starting at 0.1 s
    const s = analyze(x, rate);
    expect(s.onset).toBeGreaterThanOrEqual(0.1);
    expect(s.onset).toBeLessThan(0.101);
    expect(s.audible).toBeLessThanOrEqual(0.2);
    expect(s.audible).toBeGreaterThan(0.199);
    expect(s.tail).toBe(0);
    expect(problems(s)).toEqual([]);
  });

  it("flags silence, clipping, NaN and long sounds", () => {
    expect(problems(analyze(new Float32Array(4800), rate))[0]).toMatch(/too quiet/);
    expect(analyze(new Float32Array(4800), rate).loudness).toBe(Number.NEGATIVE_INFINITY);
    const clipped = sine(0.2, 1.2);
    clipped.fill(0, clipped.length - rate / 10);
    expect(problems(analyze(clipped, rate)).join()).toMatch(/clips/);
    const broken = sine(0.2, 0.5);
    broken[10] = Number.NaN;
    expect(problems(analyze(broken, rate)).join()).toMatch(/NaN/);
    expect(problems(analyze(sine(1.6, 0.2), rate)).join()).toMatch(/too long/);
    expect(GATE).toBe(0.001);
  });

  it("short windows read short sounds louder", () => {
    const x = new Float32Array(rate);
    x.set(sine(0.05, 0.5));
    expect(peakLoudness(x, rate, 0.1)).toBeGreaterThan(peakLoudness(x, rate, 0.4) + 5);
  });
});
