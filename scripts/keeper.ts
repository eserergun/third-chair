// Keeper for the live and test deployments. .github/workflows/keeper.yml runs it every 30 minutes.
//
// For each deployment file:
// 1. If the contract is gone (testnet reset), redeploy it from deployments/standoff.wasm. After
//    all files, exit with code 10 so the workflow commits the new files and rebuilds the site.
// 2. Otherwise call bump() to extend storage TTLs, settle abandoned rooms, and top up the purse
//    when it runs low.
//
// Needs STANDOFF_ADMIN_SECRET only for a redeploy. bump(), resolve() and fund() need no admin.
//   npx tsx scripts/keeper.ts               # live and test
//   KEEPER_ONLY=test npx tsx scripts/keeper.ts

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  Account,
  Address,
  BASE_FEE,
  Contract,
  Keypair,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
type Deployment = {
  rpcUrl: string;
  networkPassphrase: string;
  friendbotUrl: string;
  contractId: string;
  commitSecs: number;
  revealSecs: number;
  pay: string;
};
/** name is the deploy.ts --name; purse is the XLM a redeploy seeds. */
const TARGETS = [
  { name: "live", file: "deployments/testnet.json", purse: 40_000 },
  { name: "test", file: "deployments/testnet-test.json", purse: 20_000 },
].filter((t) => !process.env.KEEPER_ONLY || t.name === process.env.KEEPER_ONLY);
const LOW_PURSE_XLM = Number(process.env.LOW_PURSE_XLM || 5_000);
const TOP_UP_XLM = Number(process.env.TOP_UP_XLM || 30_000);

// The functions below act on the deployment that keep() sets.
let deployment: Deployment;
let server: rpc.Server;

async function friendbot(address: string): Promise<void> {
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch(`${deployment.friendbotUrl}?addr=${encodeURIComponent(address)}`);
    if (res.ok) return;
    await new Promise((r) => setTimeout(r, 2000 * attempt));
  }
  throw new Error(`Friendbot could not fund ${address}`);
}

async function contractAlive(): Promise<boolean> {
  const key = xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: new Address(deployment.contractId).toScAddress(),
      key: xdr.ScVal.scvLedgerKeyContractInstance(),
      durability: xdr.ContractDataDurability.persistent,
    }),
  );
  const res = await server.getLedgerEntries(key);
  return res.entries.length > 0;
}

async function send(signer: Keypair, method: string, args: xdr.ScVal[]): Promise<string> {
  const account = await server.getAccount(signer.publicKey());
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: deployment.networkPassphrase })
    .addOperation(new Contract(deployment.contractId).call(method, ...args))
    .setTimeout(120)
    .build();
  const prepared = await server.prepareTransaction(tx);
  prepared.sign(signer);
  const sent = await server.sendTransaction(prepared);
  if (sent.status === "ERROR") throw new Error(`${method} rejected`);
  const done = await server.pollTransaction(sent.hash, { attempts: 40 });
  if (done.status !== rpc.Api.GetTransactionStatus.SUCCESS) throw new Error(`${method} failed ${sent.hash}`);
  return sent.hash;
}

async function view<T>(method: string): Promise<T> {
  return viewArgs<T>(method, []);
}

async function viewArgs<T>(method: string, args: xdr.ScVal[]): Promise<T> {
  const source = Keypair.random().publicKey();
  const account = new Account(source, "0");
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: deployment.networkPassphrase })
    .addOperation(new Contract(deployment.contractId).call(method, ...args))
    .setTimeout(60)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (!rpc.Api.isSimulationSuccess(sim) || !sim.result) throw new Error(`${method} view failed`);
  return scValToNative(sim.result.retval) as T;
}

/** Returns true when it redeployed the contract. */
async function keep(target: (typeof TARGETS)[number]): Promise<boolean> {
  deployment = JSON.parse(readFileSync(path.join(ROOT, target.file), "utf8")) as Deployment;
  server = new rpc.Server(deployment.rpcUrl);
  console.log(`== ${target.name} ${deployment.contractId}`);
  if (!(await contractAlive())) {
    console.log("contract instance missing: testnet was reset, redeploying");
    if (!process.env.STANDOFF_ADMIN_SECRET) throw new Error("STANDOFF_ADMIN_SECRET is required to redeploy");
    execFileSync(
      "npx",
      [
        "tsx",
        "scripts/deploy.ts",
        "--name", target.name,
        "--skip-build",
        "--wasm", "deployments/standoff.wasm",
        "--commit", String(deployment.commitSecs),
        "--reveal", String(deployment.revealSecs),
        "--pay", deployment.pay,
        "--purse", String(target.purse),
      ],
      { cwd: ROOT, stdio: "inherit" },
    );
    return true;
  }

  // Anyone may bump. A throwaway Friendbot account pays the fee.
  const keeper = Keypair.random();
  await friendbot(keeper.publicKey());
  const hash = await send(keeper, "bump", []);
  console.log(`bump ok ${hash}`);

  // Sweep abandoned rooms: a player who closed the tab leaves a minute that nobody settles.
  // resolve is open to anyone; step each stale room until it settles (sleepers are carried out).
  const now = Number(await view<bigint>("now"));
  for (let id = 0; id < 9; id++) {
    for (let step = 0; step < 4; step++) {
      const room = await viewArgs<{ phase: number; hand: bigint; deadline: bigint; reveal_secs: bigint; commit_secs: bigint }>("room", [
        nativeToScVal(id, { type: "u32" }),
      ]);
      const stale = room.phase !== 0 && now > Number(room.deadline) + Number(room.reveal_secs) + Number(room.commit_secs);
      if (!stale && step === 0) break;
      if (room.phase === 0) break;
      try {
        await send(keeper, "resolve", [nativeToScVal(id, { type: "u32" }), nativeToScVal(room.hand, { type: "u64" })]);
        console.log(`room ${id}: stepped stale minute ${room.hand} (phase ${room.phase})`);
      } catch (e) {
        console.log(`room ${id}: ${(e as Error).message}`);
      }
      await new Promise((r) => setTimeout(r, 6000)); // one ledger
    }
  }

  const purse = await view<{ balance: bigint; pay: bigint }>("purse");
  const xlm = Number(purse.balance / 10_000_000n);
  console.log(`purse ${xlm} XLM`);
  if (xlm < LOW_PURSE_XLM) {
    let added = 0;
    while (added < TOP_UP_XLM) {
      const donor = Keypair.random();
      await friendbot(donor.publicKey());
      const amount = 9_990n * 10_000_000n;
      await send(donor, "fund", [new Address(donor.publicKey()).toScVal(), nativeToScVal(amount, { type: "i128" })]);
      added += 9_990;
      console.log(`purse +9990 XLM`);
    }
  }
  return false;
}

async function main(): Promise<void> {
  let redeployed = false;
  let failed = 0;
  for (const t of TARGETS) {
    try {
      if (await keep(t)) redeployed = true;
    } catch (e) {
      // One broken deployment must not stop the other one from being kept.
      failed++;
      console.error(`${t.name}: ${(e as Error).message}`);
    }
  }
  // A redeploy must reach the commit step even if the other deployment failed; that failure
  // repeats and fails the next run.
  if (redeployed) process.exit(10);
  if (failed) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
