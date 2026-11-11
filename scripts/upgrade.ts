// In-place wasm upgrade for existing testnet contracts. Preserves state, config, purse, and admin.
//
//   npx tsx scripts/upgrade.ts                  // build, upload, upgrade live + test
//   npx tsx scripts/upgrade.ts --skip-build     // use an existing wasm
//   npx tsx scripts/upgrade.ts --only live      // one deployment file
//
// Requires STANDOFF_ADMIN_SECRET (S...) whose public key matches each target file's `admin`.
// Never logs or writes the secret. Does NOT redeploy, reset, withdraw, or change economics.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Keypair, Networks } from "@stellar/stellar-sdk";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const WASM = path.join(ROOT, "target/wasm32v1-none/release/standoff.wasm");
const LIVE = path.join(ROOT, "deployments/testnet.json");
const TEST = path.join(ROOT, "deployments/testnet-test.json");

type DepFile = {
  name?: string;
  contractId: string;
  admin: string;
  wasmHash?: string;
  rpcUrl?: string;
  networkPassphrase?: string;
  upgradedAt?: string;
};

function stellarBin(): string {
  if (process.env.STELLAR_BIN) return process.env.STELLAR_BIN;
  const local = path.join(ROOT, ".tools/stellar");
  return existsSync(local) ? local : "stellar";
}

function sh(args: string[], opts: { quiet?: boolean } = {}): string {
  return execFileSync(stellarBin(), args, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", opts.quiet ? "pipe" : "inherit"],
  }).trim();
}

function parseArgs(argv: string[]): { skipBuild: boolean; only: "live" | "test" | "both"; wasm: string } {
  const get = (flag: string, fallback: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
  };
  const only = get("--only", "both");
  if (only !== "live" && only !== "test" && only !== "both") throw new Error("--only must be live, test, or both");
  return {
    skipBuild: argv.includes("--skip-build"),
    only: only as "live" | "test" | "both",
    wasm: get("--wasm", WASM),
  };
}

function adminSecret(expectedAdmins: string[]): { secret: string; address: string } {
  const secret = process.env.STANDOFF_ADMIN_SECRET?.trim();
  if (!secret) {
    throw new Error(
      "STANDOFF_ADMIN_SECRET is not set. Export the testnet admin S... key whose public address " +
        `matches deployments admin (${[...new Set(expectedAdmins)].join(", ")}).`,
    );
  }
  let address: string;
  try {
    address = Keypair.fromSecret(secret).publicKey();
  } catch {
    throw new Error("STANDOFF_ADMIN_SECRET is not a valid Stellar secret key.");
  }
  const unique = [...new Set(expectedAdmins)];
  if (!unique.includes(address)) {
    throw new Error(
      `STANDOFF_ADMIN_SECRET is for ${address}, but deployment admin(s) are ${unique.join(", ")}. ` +
        "Refusing to upgrade with a mismatched identity.",
    );
  }
  return { secret, address };
}

function loadDep(file: string): DepFile {
  const d = JSON.parse(readFileSync(file, "utf8")) as DepFile;
  if (!d.contractId || !d.admin) throw new Error(`${file} is missing contractId or admin`);
  return d;
}

function upgradeOne(depPath: string, wasmPath: string, wasmHash: string, source: string): void {
  const dep = loadDep(depPath);
  console.log(`upgrading ${dep.name ?? path.basename(depPath)} ${dep.contractId}`);
  // Install the wasm bytes (idempotent if the hash is already on network), then point the contract at it.
  sh([
    "contract", "install",
    "--wasm", wasmPath,
    "--source-account", source,
    "--network", "testnet",
  ]);
  sh([
    "contract", "invoke",
    "--id", dep.contractId,
    "--source-account", source,
    "--network", "testnet",
    "--",
    "upgrade",
    "--wasm_hash", wasmHash,
  ]);
  const next = { ...JSON.parse(readFileSync(depPath, "utf8")), wasmHash, upgradedAt: new Date().toISOString() };
  writeFileSync(depPath, `${JSON.stringify(next, null, 2)}\n`);
  console.log(`  wasm ${wasmHash}`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const targets: string[] = [];
  if (args.only === "live" || args.only === "both") targets.push(LIVE);
  if (args.only === "test" || args.only === "both") targets.push(TEST);
  const deps = targets.map(loadDep);
  const admin = adminSecret(deps.map((d) => d.admin));
  console.log(`admin ${admin.address}`);
  console.log(`network ${Networks.TESTNET}`);

  if (!args.skipBuild) {
    console.log("building wasm");
    sh(["contract", "build"]);
  }
  if (!existsSync(args.wasm)) throw new Error(`wasm missing: ${args.wasm}`);
  const wasm = readFileSync(args.wasm);
  const wasmHash = createHash("sha256").update(wasm).digest("hex");
  console.log(`wasm ${wasm.length} bytes, hash ${wasmHash}`);

  for (const t of targets) {
    upgradeOne(t, args.wasm, wasmHash, admin.secret);
  }
  writeFileSync(path.join(ROOT, "deployments", "standoff.wasm"), wasm);
  console.log("wrote deployments/standoff.wasm");
  console.log("upgrade complete (state preserved; no redeploy/reset)");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
