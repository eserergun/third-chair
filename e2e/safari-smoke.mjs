// Real Safari smoke through WebDriver (safaridriver). No npm packages: plain fetch to the W3C endpoint.
// Needs, once per Mac: Safari > Settings > Advanced > "Show features for web developers", then
// Develop menu > "Allow Remote Automation" (or `safaridriver --enable`, which asks for an admin password).
//
//   node e2e/safari-smoke.mjs [url]
//   default url: http://localhost:5190/third-chair/#/practice (start the practice preview first)
//
// Flow: open the practice table, Sit down, play Air (real click), wait for the settled narration,
// save a screenshot to scratch/safari/.
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

const URL_ = process.argv[2] || "http://localhost:5190/third-chair/#/practice";
const PORT = Number(process.env.SAFARIDRIVER_PORT || 4723);
const BASE = `http://localhost:${PORT}`;
const MAIN_LINE = /takes the purse|takes the chair|takes the minute|quiet minute|Nobody is standing|More than one chair|One chair is standing/;
const ELEMENT = "element-6066-11e4-a52e-4f735466cecf";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function wd(method, path, body) {
  const res = await fetch(BASE + path, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json?.value?.error) throw new Error(`${method} ${path}: ${json?.value?.error ?? res.status}: ${json?.value?.message ?? ""}`);
  return json.value;
}

async function waitFor(fn, what, ms = 30_000) {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) {
    try {
      const v = await fn();
      if (v) return v;
    } catch (e) {
      last = e;
    }
    await sleep(500);
  }
  throw new Error(`timed out waiting for ${what}${last ? ` (${last.message})` : ""}`);
}

const driver = spawn("safaridriver", ["-p", String(PORT)], { stdio: "ignore" });
let session = null;
const t0 = Date.now();
const log = (m) => console.log(`[safari +${((Date.now() - t0) / 1000).toFixed(1)} s] ${m}`);
try {
  await waitFor(() => wd("GET", "/status").then((v) => v.ready), "safaridriver", 10_000);
  const s = await wd("POST", "/session", { capabilities: { alwaysMatch: { browserName: "safari" } } });
  session = s.sessionId;
  log(`session ${session}, Safari ${s.capabilities?.browserVersion}`);
  const S = `/session/${session}`;
  const find = async (xpath) => (await wd("POST", `${S}/element`, { using: "xpath", value: xpath }))[ELEMENT];
  const text = async (xpath) => wd("GET", `${S}/element/${await find(xpath)}/text`);

  await wd("POST", `${S}/window/rect`, { width: 1280, height: 800 }).catch(() => undefined);
  await wd("POST", `${S}/url`, { url: URL_ });
  await waitFor(() => find("//canvas[contains(@class,'comic')]"), "the comic canvas");
  log("page loaded");
  await wd("POST", `${S}/element/${await waitFor(() => find("//button[normalize-space()='Sit down']"), "Sit down")}/click`, {});
  await waitFor(() => find("//button[normalize-space()='Stand up']"), "Stand up");
  log("seated");
  const air = await waitFor(async () => {
    const id = await find("//button[@aria-label='Air, key 1']");
    return (await wd("GET", `${S}/element/${id}/enabled`)) ? id : null;
  }, "Air enabled", 60_000);
  await wd("POST", `${S}/element/${air}/click`, {});
  log("played Air");
  const line = await waitFor(async () => {
    const t = await text("//*[@data-testid='narration']");
    return MAIN_LINE.test(t) ? t : null;
  }, "the settled narration", 90_000);
  log(`settled: ${line}`);
  const png = await wd("GET", `${S}/screenshot`);
  mkdirSync("scratch/safari", { recursive: true });
  writeFileSync("scratch/safari/practice-settled.png", Buffer.from(png, "base64"));
  log("screenshot scratch/safari/practice-settled.png");
  console.log("SAFARI SMOKE: PASS");
} catch (e) {
  console.error(`SAFARI SMOKE: FAIL: ${e.message}`);
  process.exitCode = 1;
} finally {
  if (session) await wd("DELETE", `/session/${session}`).catch(() => undefined);
  driver.kill();
}
