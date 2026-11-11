import { rawDeployment } from "./deployment";

export interface Deployment {
  name?: string;
  rpcUrl: string;
  networkPassphrase: string;
  friendbotUrl: string;
  contractId: string;
  nativeSac: string;
  explorer: string;
  commitSecs?: number;
  revealSecs?: number;
  pay?: string;
}

function env(name: string): string | undefined {
  try {
    const v = (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.[name];
    return v && v.length > 0 ? v : undefined;
  } catch {
    return undefined;
  }
}

export function parseDeployment(json: unknown): Deployment {
  const d = (json ?? {}) as Record<string, unknown>;
  for (const k of ["rpcUrl", "networkPassphrase", "friendbotUrl", "contractId", "nativeSac", "explorer"]) {
    if (typeof d[k] !== "string" || !(d[k] as string)) throw new Error(`Deployment is missing ${k}.`);
  }
  return d as unknown as Deployment;
}

/** Apply build-time RPC override (`VITE_RPC_URL`) without touching the rest of the deployment. */
export function withRpcOverride(d: Deployment): Deployment {
  const rpc = env("VITE_RPC_URL") ?? (typeof process !== "undefined" ? process.env?.STANDOFF_RPC_URL || process.env?.VITE_RPC_URL : undefined);
  if (!rpc || rpc === d.rpcUrl) return d;
  return { ...d, rpcUrl: rpc };
}

/** The build-time deployment, or null when no deployment file exists yet. */
export function loadDeployment(): Deployment | null {
  const raw = rawDeployment();
  if (!raw) return null;
  try {
    return withRpcOverride(parseDeployment(raw));
  } catch {
    return null;
  }
}

export function hasDeployment(): boolean {
  return loadDeployment() !== null;
}

export function storagePrefix(d: Deployment): string {
  return `standoff.v2.${d.contractId}.`;
}
