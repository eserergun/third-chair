// File-backed KeyValueStore for Node scripts. Do not import from browser code.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { KeyValueStore } from "./store";

export function fileStore(file: string): KeyValueStore {
  let data: Record<string, string> = {};
  try {
    if (existsSync(file)) data = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    data = {};
  }
  const save = () => {
    try {
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify(data, null, 2), { mode: 0o600 });
    } catch {
      /* ignore */
    }
  };
  return {
    get: (k) => data[k] ?? null,
    set: (k, v) => {
      data[k] = v;
      save();
    },
    remove: (k) => {
      delete data[k];
      save();
    },
    keys: () => Object.keys(data),
  };
}
