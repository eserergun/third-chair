// Measurements of a rendered sound, and the pass rules for the sound kit.
// Pure functions: used by scripts/audio-check.ts, dev/audio.ts and the unit tests.

/** Level that counts as audible: -60 dBFS. */
export const GATE = 0.001;

/** Pass rules for every sound in the kit. */
export const RULES = {
  /** RMS over the whole render must be above this (not silent). */
  minRms: 0.01,
  /** No sample may go above this (no clipping). */
  maxPeak: 1,
  /** The audible part must end before this many seconds. */
  maxSeconds: 1.5,
  /** The last `tailSeconds` of the render must stay under `maxTail` (the sound ended). */
  maxTail: 0.002,
  tailSeconds: 0.02,
} as const;

export interface SoundStats {
  readonly sampleRate: number;
  /** Seconds rendered. */
  readonly window: number;
  /** Root mean square over the whole render. */
  readonly rms: number;
  /** Largest absolute sample. */
  readonly peak: number;
  /** Seconds to the first sample at or above GATE (0 if silent). */
  readonly onset: number;
  /** Seconds to the end of the last sample at or above GATE (0 if silent). */
  readonly audible: number;
  /** Largest absolute sample in the last RULES.tailSeconds. */
  readonly tail: number;
  /** False if any sample is NaN or infinite. */
  readonly finite: boolean;
  /**
   * Loudest 400 ms window, K-weighted (ITU-R BS.1770 momentary loudness, mono), in LUFS.
   * Used to balance the kit by numbers. -Infinity when silent.
   */
  readonly loudness: number;
}

/** Biquad coefficients, normalized so a0 = 1. */
interface Biquad {
  readonly b0: number;
  readonly b1: number;
  readonly b2: number;
  readonly a1: number;
  readonly a2: number;
}

/** The two BS.1770 K-weighting stages (high shelf, then high pass) for any sample rate. */
function kWeighting(rate: number): readonly [Biquad, Biquad] {
  const shelfK = Math.tan((Math.PI * 1681.974450955533) / rate);
  const shelfQ = 0.7071752369554196;
  const vh = Math.pow(10, 3.999843853973347 / 20);
  const vb = Math.pow(vh, 0.4996667741545416);
  const s0 = 1 + shelfK / shelfQ + shelfK * shelfK;
  const shelf: Biquad = {
    b0: (vh + (vb * shelfK) / shelfQ + shelfK * shelfK) / s0,
    b1: (2 * (shelfK * shelfK - vh)) / s0,
    b2: (vh - (vb * shelfK) / shelfQ + shelfK * shelfK) / s0,
    a1: (2 * (shelfK * shelfK - 1)) / s0,
    a2: (1 - shelfK / shelfQ + shelfK * shelfK) / s0,
  };
  const hpK = Math.tan((Math.PI * 38.13547087602444) / rate);
  const hpQ = 0.5003270373238773;
  const h0 = 1 + hpK / hpQ + hpK * hpK;
  const highpass: Biquad = {
    b0: 1,
    b1: -2,
    b2: 1,
    a1: (2 * (hpK * hpK - 1)) / h0,
    a2: (1 - hpK / hpQ + hpK * hpK) / h0,
  };
  return [shelf, highpass];
}

function runBiquad(x: Float64Array, f: Biquad): void {
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const x0 = x[i];
    const y0 = f.b0 * x0 + f.b1 * x1 + f.b2 * x2 - f.a1 * y1 - f.a2 * y2;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
    x[i] = y0;
  }
}

/**
 * Loudest K-weighted window, in LUFS (mono). With the default 0.4 s window this is the
 * BS.1770 momentary loudness. A shorter window (0.1 s) suits short, punchy sounds better.
 * -Infinity when silent.
 */
export function peakLoudness(x: ArrayLike<number>, rate: number, windowSeconds = 0.4): number {
  const n = x.length;
  if (n === 0) return Number.NEGATIVE_INFINITY;
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = Number.isFinite(x[i]) ? x[i] : 0;
  const [shelf, highpass] = kWeighting(rate);
  runBiquad(w, shelf);
  runBiquad(w, highpass);
  // Prefix sums of squares, so every window is O(1).
  const sq = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) sq[i + 1] = sq[i] + w[i] * w[i];
  const win = Math.max(1, Math.round(windowSeconds * rate));
  const hop = Math.max(1, Math.round(0.01 * rate));
  let best = 0;
  // Windows may hang past the end: the missing part counts as silence.
  for (let start = 0; start < n; start += hop) {
    const end = Math.min(n, start + win);
    const ms = (sq[end] - sq[start]) / win;
    if (ms > best) best = ms;
  }
  return best > 0 ? -0.691 + 10 * Math.log10(best) : Number.NEGATIVE_INFINITY;
}

export function analyze(x: ArrayLike<number>, sampleRate: number): SoundStats {
  const n = x.length;
  let sum = 0;
  let peak = 0;
  let first = -1;
  let last = -1;
  let finite = true;
  for (let i = 0; i < n; i++) {
    const v = x[i];
    if (!Number.isFinite(v)) {
      finite = false;
      continue;
    }
    const a = Math.abs(v);
    sum += v * v;
    if (a > peak) peak = a;
    if (a >= GATE) {
      if (first < 0) first = i;
      last = i;
    }
  }
  const tailCount = Math.min(n, Math.max(1, Math.round(RULES.tailSeconds * sampleRate)));
  let tail = 0;
  for (let i = n - tailCount; i < n; i++) {
    const a = Math.abs(x[i]);
    if (a > tail) tail = a;
  }
  return {
    sampleRate,
    window: n / sampleRate,
    rms: n > 0 ? Math.sqrt(sum / n) : 0,
    peak,
    onset: first < 0 ? 0 : first / sampleRate,
    audible: last < 0 ? 0 : (last + 1) / sampleRate,
    tail,
    finite,
    loudness: peakLoudness(x, sampleRate),
  };
}

/** Broken rules, in plain words. Empty when the sound passes. */
export function problems(s: SoundStats): string[] {
  const out: string[] = [];
  if (!s.finite) out.push("has NaN or infinite samples");
  if (!(s.rms > RULES.minRms)) out.push(`too quiet: RMS ${s.rms.toFixed(4)} <= ${RULES.minRms}`);
  if (!(s.peak <= RULES.maxPeak)) out.push(`clips: peak ${s.peak.toFixed(4)} > ${RULES.maxPeak}`);
  if (!(s.audible < RULES.maxSeconds)) out.push(`too long: ${s.audible.toFixed(3)} s >= ${RULES.maxSeconds} s`);
  if (!(s.tail < RULES.maxTail)) {
    out.push(`cut off: peak ${s.tail.toFixed(4)} in the last ${RULES.tailSeconds * 1000} ms`);
  }
  return out;
}
