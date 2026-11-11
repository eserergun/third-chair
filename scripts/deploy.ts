// Deploy the Third Chair contract to Stellar testnet and seed the purse.
//
//   npx tsx scripts/deploy.ts --name live                 # commit 60 s, reveal 30 s
//   npx tsx scripts/deploy.ts --name test --commit 20 --reveal 15 --purse 20000
//
// Admin: STANDOFF_ADMIN_SECRET (S...) if set, else the local `stellar keys` identity named by
// STANDOFF_ADMIN (default "standoff-admin"). Secrets are never written to disk by this script.
// Output: deployments/testnet.json (live) or deployments/testnet-<name>.json (others).

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  Address,
  BASE_FEE,
  Contract,
  Keypair,
  Networks,
  TransactionBuilder,
  nativeToScVal,
  rpc,
} from "@stellar/stellar-sdk";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const RPC_URL = "https://soroban-testnet.stellar.org";
const HORIZON_URL = "https://horizon-testnet.stellar.org";
const FRIENDBOT = "https://friendbot.stellar.org";
const PASSPHRASE = Networks.TESTNET;
const NATIVE_SAC = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
const WASM = path.join(ROOT, "target/wasm32v1-none/release/standoff.wasm");

type Args = { name: string; commit: number; reveal: number; pay: bigint; hourBudget: number; dayCap: number; purse: number; skipBuild: boolean; wasm: string };

function parseArgs(argv: string[]): Args {
  const get = (flag: string, fallback: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
  };
  return {
    name: get("--name", "live"),
    commit: Number(get("--commit", "60")),
    reveal: Number(get("--reveal", "30")),
    pay: BigInt(get("--pay", "10000000")),
    hourBudget: Number(get("--hour-budget", "60")),
    dayCap: Number(get("--day-cap", "25")),
    purse: Number(get("--purse", "40000")),
    skipBuild: argv.includes("--skip-build") || argv.includes("--wasm"),
    wasm: get("--wasm", WASM),
  };
}

function stellarBin(): string {
  if (process.env.STELLAR_BIN) return process.env.STELLAR_BIN;
  const local = path.join(ROOT, ".tools/stellar");
  return existsSync(local) ? local : "stellar";
}

function sh(args: string[], opts: { quiet?: boolean } = {}): string {
  const out = execFileSync(stellarBin(), args, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", opts.quiet ? "pipe" : "inherit"],
  });
  return out.trim();
}

function adminSource(): { source: string; address: string } {
  const secret = process.env.STANDOFF_ADMIN_SECRET;
  if (secret) return { source: secret, address: Keypair.fromSecret(secret).publicKey() };
  const alias = process.env.STANDOFF_ADMIN || "standoff-admin";
  return { source: alias, address: sh(["keys", "address", alias], { quiet: true }) };
}

async function friendbot(address: string): Promise<void> {
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch(`${FRIENDBOT}?addr=${encodeURIComponent(address)}`);
    if (res.ok) return;
    const body = await res.text();
    if (body.includes("createAccountAlreadyExist") || body.includes("op_already_exists")) return;
    await new Promise((r) => setTimeout(r, 1500 * attempt));
  }
  throw new Error(`Friendbot could not fund ${address}`);
}

async function accountExists(address: string): Promise<boolean> {
  const res = await fetch(`${HORIZON_URL}/accounts/${address}`);
  return res.ok;
}

async function invoke(server: rpc.Server, signer: Keypair, contractId: string, method: string, args: ReturnType<typeof nativeToScVal>[]): Promise<string> {
  const account = await server.getAccount(signer.publicKey());
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: PASSPHRASE })
    .addOperation(new Contract(contractId).call(method, ...args))
    .setTimeout(120)
    .build();
  const prepared = await server.prepareTransaction(tx);
  prepared.sign(signer);
  const sent = await server.sendTransaction(prepared);
  if (sent.status === "ERROR") throw new Error(`${method} rejected: ${sent.errorResult?.toXDR("base64")}`);
  const done = await server.pollTransaction(sent.hash, { attempts: 40 });
  if (done.status !== rpc.Api.GetTransactionStatus.SUCCESS) throw new Error(`${method} failed: ${done.status} ${sent.hash}`);
  return sent.hash;
}

async function seedPurse(server: rpc.Server, contractId: string, xlm: number): Promise<number> {
  // Friendbot gives 10,000 XLM per new account. Each donor keeps 10 XLM for reserves and fees.
  const perDonor = 9_990;
  const donors = Math.ceil(xlm / perDonor);
  let funded = 0;
  for (let i = 0; i < donors; i++) {
    const donor = Keypair.random();
    await friendbot(donor.publicKey());
    const amount = BigInt(Math.min(perDonor, xlm - funded)) * 10_000_000n;
    await invoke(server, donor, contractId, "fund", [
      new Address(donor.publicKey()).toScVal(),
      nativeToScVal(amount, { type: "i128" }),
    ]);
    funded += Number(amount / 10_000_000n);
    console.log(`  purse +${Number(amount / 10_000_000n)} XLM (donor ${donor.publicKey().slice(0, 8)}...)`);
  }
  return funded;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const server = new rpc.Server(RPC_URL);
  const admin = adminSource();
  console.log(`admin ${admin.address}`);
  if (!(await accountExists(admin.address))) {
    console.log("funding admin with Friendbot");
    await friendbot(admin.address);
  }

  if (!args.skipBuild) {
    console.log("building wasm");
    sh(["contract", "build"]);
  }
  const wasm = readFileSync(args.wasm);
  const wasmHash = createHash("sha256").update(wasm).digest("hex");
  console.log(`wasm ${wasm.length} bytes, hash ${wasmHash}`);

  console.log(`deploying "${args.name}" (commit ${args.commit}s, reveal ${args.reveal}s, pay ${args.pay})`);
  const out = sh([
    "contract", "deploy",
    "--wasm", args.wasm,
    "--source-account", admin.source,
    "--network", "testnet",
    "--",
    "--admin", admin.address,
    "--token", NATIVE_SAC,
    "--commit_secs", String(args.commit),
    "--reveal_secs", String(args.reveal),
    "--pay", args.pay.toString(),
    "--hour_budget", String(args.hourBudget),
    "--day_cap", String(args.dayCap),
  ]);
  const contractId = out.split(/\s+/).reverse().find((t) => /^C[A-Z2-7]{55}$/.test(t));
  if (!contractId) throw new Error(`could not read the contract id from: ${out}`);
  console.log(`contract ${contractId}`);

  const latest = await server.getLatestLedger();
  let purse = 0;
  if (args.purse > 0) {
    console.log(`seeding the purse with ${args.purse} XLM`);
    purse = await seedPurse(server, contractId, args.purse);
  }

  const deployment = {
    name: args.name,
    network: "testnet",
    rpcUrl: RPC_URL,
    horizonUrl: HORIZON_URL,
    networkPassphrase: PASSPHRASE,
    friendbotUrl: FRIENDBOT,
    explorer: "https://stellar.expert/explorer/testnet",
    contractId,
    nativeSac: NATIVE_SAC,
    wasmHash,
    admin: admin.address,
    commitSecs: args.commit,
    revealSecs: args.reveal,
    pay: args.pay.toString(),
    hourBudget: args.hourBudget,
    dayCap: args.dayCap,
    seededXlm: purse,
    // How this wasm was built, so anyone can rebuild it byte for byte (rust-toolchain.toml pins rustc).
    build: {
      rustc: execFileSync("rustc", ["--version"], { cwd: ROOT, encoding: "utf8" }).trim(),
      stellarCli: sh(["--version"], { quiet: true }).split("\n")[0],
      command: "stellar contract build",
      wasmBytes: wasm.length,
    },
    deployedAt: new Date().toISOString(),
    deployedLedger: latest.sequence,
  };
  mkdirSync(path.join(ROOT, "deployments"), { recursive: true });
  const file = path.join(ROOT, "deployments", args.name === "live" ? "testnet.json" : `testnet-${args.name}.json`);
  writeFileSync(file, `${JSON.stringify(deployment, null, 2)}\n`);
  // Keep the exact wasm next to the deployment so the keeper can redeploy after a testnet reset
  // without a Rust toolchain.
  writeFileSync(path.join(ROOT, "deployments", "standoff.wasm"), wasm);
  console.log(`wrote ${path.relative(ROOT, file)} and deployments/standoff.wasm`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
