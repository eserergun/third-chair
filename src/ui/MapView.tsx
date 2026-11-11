import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { GameClient, RoomSummary } from "../shared/game-client";
import { ROOM_NAMES } from "../shared/game-client";
import { Links } from "./ctx";
import { warmSession } from "./door";
import { SLUGS, go, intent } from "./router";

// SPEC 3: anchors as fractions of survey.jpg (1280x720).
export const ANCHORS: ReadonlyArray<[number, number]> = [
  [0.368, 0.256],
  [0.552, 0.26],
  [0.818, 0.303],
  [0.373, 0.497],
  [0.608, 0.547],
  [0.862, 0.484],
  [0.185, 0.725],
  [0.602, 0.814],
  [0.825, 0.788],
];

/** Room the chips need around their anchor, in stage px: the chip sits above the hamlet. */
const CHIP_MARGIN = { left: 84, right: 84, top: 76, bottom: 22 };

type Fit = {
  /** Painting rect inside the stage, in px. */
  left: number;
  top: number;
  width: number;
  height: number;
  stageW: number;
  stageH: number;
  /** True when the painting covers the whole stage. */
  cover: boolean;
};

/**
 * Scale the painting to cover the stage, but never so far that a hamlet chip leaves the view.
 * The crop centres on the anchors' bounding box and stays inside the painting.
 * When cover would hide a chip, the scale drops toward contain and a blurred copy fills the rest.
 */
export function fitPainting(stageW: number, stageH: number, imgW: number, imgH: number): Fit {
  const xs = ANCHORS.map((a) => a[0]);
  const ys = ANCHORS.map((a) => a[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const coverS = Math.max(stageW / imgW, stageH / imgH);
  const containS = Math.min(stageW / imgW, stageH / imgH);
  // A painting that overflows an axis must still show the anchor span plus the chip margins.
  const limitX = (stageW - CHIP_MARGIN.left - CHIP_MARGIN.right) / ((maxX - minX) * imgW);
  const limitY = (stageH - CHIP_MARGIN.top - CHIP_MARGIN.bottom) / ((maxY - minY) * imgH);
  let s = coverS;
  if (imgW * s > stageW + 0.5) s = Math.min(s, Math.max(limitX, stageW / imgW));
  if (imgH * s > stageH + 0.5) s = Math.min(s, Math.max(limitY, stageH / imgH));
  s = Math.max(containS, Math.min(coverS, s));
  const width = imgW * s;
  const height = imgH * s;
  const place = (d: number, view: number, lo: number, hi: number, mLo: number, mHi: number): number => {
    if (d <= view) return (view - d) / 2;
    // c is how far the view's edge sits inside the painting.
    let c = ((lo + hi) / 2) * d - view / 2;
    const need = Math.max(0, hi * d + mHi - view);
    const room = Math.min(d - view, lo * d - mLo);
    // At the scale limit need and room meet; allow for float error.
    if (need <= room + 1) c = Math.max(need, Math.min(room, c));
    c = Math.max(0, Math.min(d - view, c));
    return -c;
  };
  return {
    left: place(width, stageW, minX, maxX, CHIP_MARGIN.left, CHIP_MARGIN.right),
    top: place(height, stageH, minY, maxY, CHIP_MARGIN.top, CHIP_MARGIN.bottom),
    width,
    height,
    stageW,
    stageH,
    cover: width >= stageW - 0.5 && height >= stageH - 0.5,
  };
}

function chipStatus(s: RoomSummary | undefined): string {
  if (!s) return "Reading";
  if (s.phase === "idle") return "Rehearsal";
  const n = s.players;
  return `${n} at the table${s.queued ? `, ${s.queued} waiting` : ""}`;
}

/** Short status for the phone map chips: the dot carries live or rehearsal, the text the count. */
function chipShort(s: RoomSummary | undefined): string {
  if (!s) return "...";
  if (s.phase === "idle") return "house";
  return `${s.players}/3${s.queued ? ` +${s.queued}` : ""}`;
}

const REHEARSAL_HINT = "The house rehearses here until a player sits. Nothing touches the chain.";

/** Solid rust dot while a minute runs; an open ring while the house rehearses. */
function StatusDot({ s }: { s: RoomSummary | undefined }): React.JSX.Element | null {
  if (!s) return null;
  return <span className={s.phase === "idle" ? "idle-dot" : "live-dot"} aria-hidden="true" />;
}

function useNarrow(): boolean {
  const q = "(max-width: 640px)";
  const [narrow, setNarrow] = useState(() => {
    try {
      return matchMedia(q).matches;
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      const mq = matchMedia(q);
      const on = (): void => setNarrow(mq.matches);
      mq.addEventListener("change", on);
      return () => mq.removeEventListener("change", on);
    } catch {
      return undefined;
    }
  }, []);
  return narrow;
}

export function MapView({ client }: { client: GameClient }): React.JSX.Element {
  const narrow = useNarrow();
  const stageRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [fit, setFit] = useState<Fit | null>(null);
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [slip, setSlip] = useState<number | null>(null);

  // An open slip is interest in a room: start the session key's Friendbot funding now.
  useEffect(() => {
    if (slip !== null) warmSession(client);
  }, [slip, client]);

  useEffect(() => {
    let live = true;
    let h: ReturnType<typeof setTimeout>;
    const load = async (): Promise<void> => {
      try {
        const r = await client.rooms();
        if (live) setRooms(r);
      } catch {
        // keep the last good read
      }
      if (live) h = setTimeout(load, document.hidden ? 10000 : 8000);
    };
    void load();
    return () => {
      live = false;
      clearTimeout(h);
    };
  }, [client]);

  // Desktop and laptop: cover the stage, crop around the hamlets. Phones keep the sideways pan.
  const refit = useCallback((): void => {
    const el = stageRef.current;
    const img = imgRef.current;
    if (!el || narrow) {
      setFit(null);
      return;
    }
    const w = el.clientWidth;
    const h = el.clientHeight;
    if (w <= 0 || h <= 0) return;
    const iw = img && img.naturalWidth > 0 ? img.naturalWidth : 1280;
    const ih = img && img.naturalHeight > 0 ? img.naturalHeight : 720;
    const next = fitPainting(w, h, iw, ih);
    setFit((prev) =>
      prev &&
      prev.stageW === next.stageW &&
      prev.stageH === next.stageH &&
      Math.abs(prev.width - next.width) < 0.5 &&
      Math.abs(prev.height - next.height) < 0.5
        ? prev
        : next,
    );
  }, [narrow]);

  useLayoutEffect(() => {
    refit();
    const el = stageRef.current;
    if (!el || narrow || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(() => refit());
    ro.observe(el);
    return () => ro.disconnect();
  }, [refit, narrow]);

  // The stage clips the cropped painting: keep an open slip fully inside it.
  const slipRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = slipRef.current;
    const stage = stageRef.current;
    if (!el || !stage) return;
    el.style.marginLeft = "";
    el.style.marginTop = "";
    if (narrow || !fit) return;
    const pad = 8;
    const r = el.getBoundingClientRect();
    const b = stage.getBoundingClientRect();
    const dx = r.left < b.left + pad ? b.left + pad - r.left : r.right > b.right - pad ? Math.max(b.left + pad - r.left, b.right - pad - r.right) : 0;
    const dy = r.top < b.top + pad ? b.top + pad - r.top : r.bottom > b.bottom - pad ? Math.max(b.top + pad - r.top, b.bottom - pad - r.bottom) : 0;
    if (dx) el.style.marginLeft = `${dx}px`;
    if (dy) el.style.marginTop = `${dy}px`;
  });

  // Phones pan the painting sideways: start in the middle of the river.
  useEffect(() => {
    const el = stageRef.current;
    if (el && el.scrollWidth > el.clientWidth) el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2;
  }, [narrow]);

  useEffect(() => {
    const k = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setSlip(null);
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);

  const base = import.meta.env.BASE_URL;
  const s = slip === null ? undefined : rooms.find((r) => r.id === slip);
  const layout = narrow ? null : fit;

  /** Open the slip toward the room left on screen, not on the painting. */
  const slipSide = (i: number): string => {
    const [ax, ay] = ANCHORS[i];
    if (!layout) return `${ax > 0.6 ? " slip-left" : ""}${ay > 0.6 ? " slip-up" : ""}`;
    const x = layout.left + ax * layout.width;
    const y = layout.top + ay * layout.height;
    const h = x < 160 ? " slip-right" : x > layout.stageW - 160 || x / layout.stageW > 0.6 ? " slip-left" : "";
    const v = y / layout.stageH > 0.55 ? " slip-up" : "";
    return h + v;
  };

  return (
    <main className="map-page">
      <div className={`map-stage${layout ? " is-fit" : ""}`} ref={stageRef}>
        {layout ? <img className="survey-backdrop" src={`${base}survey.jpg`} alt="" aria-hidden="true" /> : null}
        <div
          className="map-frame"
          style={layout ? { left: `${layout.left}px`, top: `${layout.top}px`, width: `${layout.width}px`, height: `${layout.height}px` } : undefined}
        >
          <img
            ref={imgRef}
            className="survey"
            src={`${base}survey.jpg`}
            alt="A survey painting of nine hamlets along the Glass River"
            width={1280}
            height={720}
            onLoad={refit}
          />
          {ROOM_NAMES.map((name, i) => {
            const st = rooms.find((r) => r.id === i);
            const live = !!st && st.phase !== "idle";
            return (
              <button
                key={name}
                type="button"
                className={`town-chip${slip === i ? " active" : ""}`}
                data-room={SLUGS[i]}
                style={{ left: `${ANCHORS[i][0] * 100}%`, top: `${ANCHORS[i][1] * 100}%` }}
                onClick={() => setSlip(slip === i ? null : i)}
                aria-expanded={slip === i}
                aria-label={`${name}: ${chipStatus(st)}`}
              >
                <span className="town-name">{name}</span>
                <span className={`town-status${live ? " is-live" : ""}`}>
                  <StatusDot s={st} />
                  {narrow ? chipShort(st) : chipStatus(st)}
                </span>
              </button>
            );
          })}
          {slip !== null ? (
            <div
              ref={slipRef}
              className={`slip${slipSide(slip)}`}
              role="dialog"
              aria-label={`${ROOM_NAMES[slip]} slip`}
              style={{ left: `${ANCHORS[slip][0] * 100}%`, top: `${ANCHORS[slip][1] * 100}%` }}
            >
              <h2>{ROOM_NAMES[slip]}</h2>
              <p>Three chairs. You take one. The house sits the other two until somebody else walks in.</p>
              <p className="slip-status">
                <StatusDot s={s} />
                {s && s.phase !== "idle" ? `A minute is running. ${chipStatus(s)}.` : chipStatus(s)}
              </p>
              {s?.phase === "idle" ? <p className="slip-hint">{REHEARSAL_HINT}</p> : null}
              <p className="slip-stake">
                Free to sit. The last one standing wins 1 XLM. <a href="#/how">How it works</a>
              </p>
              <div className="slip-buttons">
                <button
                  type="button"
                  className="btn btn-rust"
                  onClick={() => {
                    intent.sit = slip;
                    go(`#/room/${SLUGS[slip]}`);
                  }}
                >
                  Walk in
                </button>
                <button type="button" className="btn" onClick={() => go(`#/room/${SLUGS[slip]}`)}>
                  Watch the minute
                </button>
              </div>
              <button type="button" className="x slip-x" aria-label="Close" onClick={() => setSlip(null)}>
                x
              </button>
            </div>
          ) : null}
        </div>
      </div>
      <footer className="dock map-dock">
        <p className="dock-line">Nine rooms along the Glass River. Walk into any one. The house sits the other two chairs.</p>
        {narrow ? (
          <>
            <p className="dock-line dim">Swipe the map sideways, or pick a room below.</p>
            <ul className="room-list" aria-label="Rooms">
              {ROOM_NAMES.map((name, i) => {
                const st = rooms.find((r) => r.id === i);
                return (
                  <li key={name}>
                    <button
                      type="button"
                      className={`room-row${slip === i ? " active" : ""}`}
                      data-room={SLUGS[i]}
                      aria-expanded={slip === i}
                      onClick={() => {
                        setSlip(slip === i ? null : i);
                        // Pan the painting so the chosen hamlet is in view.
                        const el = stageRef.current;
                        if (el && el.scrollWidth > el.clientWidth) el.scrollTo({ left: ANCHORS[i][0] * el.scrollWidth - el.clientWidth / 2, behavior: "smooth" });
                      }}
                    >
                      <b>{name}</b>
                      <span>
                        <StatusDot s={st} />
                        {!st ? "Reading" : st.phase === "idle" ? "Rehearsal" : `${st.players} seated${st.queued ? `, ${st.queued} waiting` : ""}`}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        ) : null}
        <Links client={client} />
      </footer>
    </main>
  );
}
