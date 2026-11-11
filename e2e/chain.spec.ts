import { expect, test } from "@playwright/test";

// Runs against the short-window test contract (deployments/testnet-test.json) on Stellar testnet.
const SHOTS_BASE = "scratch/chain";
const MAIN_LINE = /takes the purse|takes the chair|takes the minute|quiet minute|Nobody is standing|More than one chair|One chair is standing/;

test("guest: walk in, play Air, see the settled hand from the chain", async ({ page }, info) => {
  const SHOTS = info.project.name === "chain" ? SHOTS_BASE : `${SHOTS_BASE}/${info.project.name}`;
  page.on("console", (m) => { if (m.type() === "error") console.log("[console]", m.text()); });
  // Every tx link a toast shows, kept as evidence (the toasts fade, so collect them as they appear).
  const t0 = Date.now();
  const mark = (label: string): void => console.log(`[${info.project.name}] ${label} at +${((Date.now() - t0) / 1000).toFixed(1)} s`);
  await page.exposeFunction("__txSeen", (href: string) => console.log(`[${info.project.name}] tx ${href}`));
  await page.addInitScript(() => {
    const seen = new Set<string>();
    new MutationObserver(() => {
      document.querySelectorAll<HTMLAnchorElement>('a[href*="/tx/"]').forEach((a) => {
        if (seen.has(a.href)) return;
        seen.add(a.href);
        (window as unknown as { __txSeen: (h: string) => void }).__txSeen(a.href);
      });
    }).observe(document, { childList: true, subtree: true });
  });
  await page.goto(`#/room/${process.env.CHAIN_ROOM || "abelen"}`);
  await expect(page.locator("canvas.comic")).toBeVisible();
  await page.getByRole("button", { name: "Sit down", exact: true }).click();
  const doors = page.getByRole("dialog", { name: "Three doors into the saloon" });
  await doors.getByRole("button", { name: /Walk in as a guest/ }).click();
  await expect(page.getByRole("button", { name: "Stand up", exact: true })).toBeVisible({ timeout: 90_000 });
  mark("seated");
  await page.screenshot({ path: `${SHOTS}/guest-seated.png` });
  // A running minute queues the newcomer; the croupier settles it and seats them.
  await expect(page.getByRole("button", { name: /^Air, key 1$/ })).toBeEnabled({ timeout: 150_000 });
  mark("cards open");
  await page.keyboard.press("1");
  await expect(page.getByTestId("your-status")).toContainText(/Your card is (shown|face down)|turning over|locked|settl/i, { timeout: 60_000 });
  mark("card sent");
  await page.screenshot({ path: `${SHOTS}/guest-played.png` });
  // Wait for the hand our card went into, not an older narration still on screen.
  const minute = Number(/Minute (\d+)/.exec((await page.getByTestId("mode-line").textContent()) ?? "")?.[1]);
  expect(minute).toBeGreaterThan(0);
  await expect(page.getByTestId("narration")).toContainText(new RegExp(`^Minute ${minute}\\. `), { timeout: 120_000 });
  await expect(page.getByTestId("narration")).toContainText(MAIN_LINE);
  mark(`settled: ${await page.getByTestId("narration").textContent()}`);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${SHOTS}/guest-reveal.png` });
  // Leave the room clean for the next run: a lone player with no card down stands up at once;
  // otherwise this client stays until its minute settles.
  await page.getByRole("button", { name: "Stand up", exact: true }).click();
  await expect(page.getByRole("button", { name: "Sit down", exact: true })).toBeVisible({ timeout: 120_000 });
  mark("stood up");
});
