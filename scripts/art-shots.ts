// Saves a 3x PNG of every canvas in dev/art.html to scratch/art/.
// Run: cd /Users/eserergun/third-chair && npx tsx scripts/art-shots.ts [filter]
// An optional filter keeps only canvases whose name contains it (old PNGs are kept then).

import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";
import { createServer } from "vite";

const ROOT = "/Users/eserergun/third-chair";
const OUT = join(ROOT, "scratch", "art");
const PORT = 5181;
const URL = `http://localhost:${PORT}/third-chair/dev/art.html`;

async function main(): Promise<void> {
  const filter = process.argv[2] ?? "";
  mkdirSync(OUT, { recursive: true });
  if (!filter) for (const f of readdirSync(OUT)) if (f.endsWith(".png")) rmSync(join(OUT, f));

  const server = await createServer({
    root: ROOT,
    base: "/third-chair/",
    configFile: false,
    logLevel: "error",
    clearScreen: false,
    server: { port: PORT, strictPort: true },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  await server.listen();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    await page.goto(URL);
    await page.waitForFunction(() => document.body.dataset.ready === "1" || document.body.dataset.ready === "error", null, {
      timeout: 60000,
    });
    if (errors.length) throw new Error(`page errors:\n${errors.join("\n")}`);
    const off = await page.evaluate(() => document.body.dataset.offPalette ?? "[]");
    const offList = JSON.parse(off) as string[];
    console.log(offList.length ? `OFF-PALETTE pixels:\n${offList.join("\n")}` : "palette check: every canvas uses only the four inks");
    const names = await page.$$eval("canvas[data-name]", (cs) => cs.map((c) => (c as HTMLCanvasElement).dataset.name ?? ""));
    let saved = 0;
    for (const name of names) {
      if (filter && !name.includes(filter)) continue;
      await page.locator(`canvas[data-name="${name}"]`).screenshot({ path: join(OUT, `${name}.png`) });
      saved++;
    }
    if (errors.length) throw new Error(`page errors:\n${errors.join("\n")}`);
    console.log(`saved ${saved} of ${names.length} canvases to ${OUT}`);
  } finally {
    await browser.close();
    await server.close();
  }
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
