// Picks the GameClient. Chain by default, practice on #/practice. The real factories are
// loaded through import.meta.glob so the site still builds while they are being written;
// a missing factory falls back to the scripted stub (src/ui/dev/stub-client.ts).

import type { GameClient, RoomView } from "../shared/game-client";
import { createStubClient, stubRehearsal } from "./dev/stub-client";

type PracticeMod = {
  createPracticeClient?: () => GameClient;
  rehearsal?: (seedKey: string, room: number, ledgerTime: number) => RoomView;
};
type ChainMod = { createChainClient?: () => GameClient };

const practiceMods = import.meta.glob<PracticeMod>("../game/practice.ts", { eager: true });
const chainMods = import.meta.glob<ChainMod>("../chain/client.ts", { eager: true });
const practiceMod: PracticeMod = Object.values(practiceMods)[0] ?? {};
const chainMod: ChainMod = Object.values(chainMods)[0] ?? {};

/** Force the stub in tests: ?stub=1 in the URL before the hash. */
const forceStub = (() => {
  try {
    return new URLSearchParams(location.search).has("stub");
  } catch {
    return false;
  }
})();
/** Stub test knobs: ?stub=1&latetx=6000&housetable=1 (see StubOptions). */
const stubKnobs = (() => {
  try {
    const q = new URLSearchParams(location.search);
    return { lateTxMs: Number(q.get("latetx") || 0), houseTable: q.has("housetable") };
  } catch {
    return { lateTxMs: 0, houseTable: false };
  }
})();

let chain: GameClient | null = null;
let practice: GameClient | null = null;
export let chainError: string | null = null;

export function chainClient(): GameClient {
  if (chain) return chain;
  if (!forceStub && chainMod.createChainClient) {
    try {
      chain = chainMod.createChainClient();
      return chain;
    } catch (e) {
      chainError = (e as Error).message || "The contract is not reachable.";
    }
  } else if (!forceStub) chainError = "The chain client is not built yet. This map runs on a stub.";
  chain = createStubClient({ mode: "chain", busy: forceStub ? [3, 7] : [], ...(forceStub ? stubKnobs : {}) });
  return chain;
}

export function practiceClient(): GameClient {
  if (practice) return practice;
  practice = !forceStub && practiceMod.createPracticeClient ? practiceMod.createPracticeClient() : createStubClient({ mode: "practice" });
  return practice;
}

export function usingStub(): { chain: boolean; practice: boolean } {
  return { chain: forceStub || !chainMod.createChainClient, practice: forceStub || !practiceMod.createPracticeClient };
}

/** The house rehearsal for an idle room (SPEC 6.5): a house-only RoomView at this ledger time. */
export function rehearsal(seedKey: string, room: number, ledgerTime: number): RoomView {
  const fn = !forceStub ? practiceMod.rehearsal : undefined;
  if (fn) {
    try {
      return fn(seedKey, room, ledgerTime);
    } catch {
      // fall through to the stub rehearsal
    }
  }
  return stubRehearsal(seedKey, room, ledgerTime);
}
