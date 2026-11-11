// Injectable key-value storage. Every access is wrapped in try/catch (SPEC 6.1).

export interface KeyValueStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
  keys(): string[];
}

export function memoryStore(init?: Record<string, string>): KeyValueStore {
  const m = new Map<string, string>(Object.entries(init ?? {}));
  return {
    get: (k) => m.get(k) ?? null,
    set: (k, v) => void m.set(k, v),
    remove: (k) => void m.delete(k),
    keys: () => [...m.keys()],
  };
}

/** localStorage when it works, else memory. Safe to call in Node. */
export function browserStore(): KeyValueStore {
  let ls: Storage | null = null;
  try {
    ls = (globalThis as { localStorage?: Storage }).localStorage ?? null;
    if (ls) {
      ls.setItem("standoff.probe", "1");
      ls.removeItem("standoff.probe");
    }
  } catch {
    ls = null;
  }
  if (!ls) return memoryStore();
  const s = ls;
  return {
    get(k) {
      try {
        return s.getItem(k);
      } catch {
        return null;
      }
    },
    set(k, v) {
      try {
        s.setItem(k, v);
      } catch {
        /* full or blocked */
      }
    },
    remove(k) {
      try {
        s.removeItem(k);
      } catch {
        /* blocked */
      }
    },
    keys() {
      try {
        const out: string[] = [];
        for (let i = 0; i < s.length; i++) {
          const k = s.key(i);
          if (k !== null) out.push(k);
        }
        return out;
      } catch {
        return [];
      }
    },
  };
}
