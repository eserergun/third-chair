// Writes public/skill.md from skill.template.md and the deployment file, so the agent
// interface always names the contract the site uses. Runs before `vite` and `vite build`.
//   VITE_DEPLOYMENT=deployments/testnet-test.json npx tsx scripts/gen-skill.ts

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
// VITE_DEPLOYMENT may be a path ("deployments/testnet-test.json") or, as the browser build reads
// it, a bare file name in deployments/ ("testnet-test.json").
function resolveDeployment(): string {
  const wanted = process.env.VITE_DEPLOYMENT || "deployments/testnet.json";
  const direct = path.resolve(ROOT, wanted);
  if (existsSync(direct)) return direct;
  return path.resolve(ROOT, "deployments", path.basename(wanted));
}
const deploymentPath = resolveDeployment();
// The site URL follows the build's base path, so /third-chair/test/ gets its own links.
const SITE_URL = process.env.SITE_URL || `https://eserergun.github.io${process.env.VITE_BASE || "/third-chair/"}`;

if (!existsSync(deploymentPath)) {
  // Fail the build: a stale skill.md would send agents to the wrong contract.
  console.error(`gen-skill: ${path.relative(ROOT, deploymentPath)} not found`);
  process.exit(1);
}

const d = JSON.parse(readFileSync(deploymentPath, "utf8")) as {
  contractId: string;
  commitSecs: number;
  revealSecs: number;
  pay: string;
};
const payXlm = (Number(BigInt(d.pay)) / 10_000_000).toString();
const out = readFileSync(path.join(ROOT, "skill.template.md"), "utf8")
  .replaceAll("{{CONTRACT_ID}}", d.contractId)
  .replaceAll("{{SITE_URL}}", SITE_URL)
  .replaceAll("{{COMMIT_SECS}}", String(d.commitSecs))
  .replaceAll("{{REVEAL_SECS}}", String(d.revealSecs))
  .replaceAll("{{PAY_XLM}}", payXlm);
if (out.includes("{{")) throw new Error("gen-skill: unfilled placeholder in skill.template.md");
writeFileSync(path.join(ROOT, "public/skill.md"), out);
console.log(`gen-skill: public/skill.md for ${d.contractId}`);
