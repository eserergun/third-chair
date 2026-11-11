import { expect, test, type Page } from "@playwright/test";

// The default Chromium project keeps the old paths; other projects get their own folder.
const shotDir = (base: string): string => {
  const name = test.info().project.name;
  return name === "practice" ? base : `${base}/${name}`;
};
const SHOTS_BASE = "scratch/ui2";
const MAIN_LINE = /takes the purse|takes the chair|takes the minute|quiet minute|Nobody is standing|More than one chair|One chair is standing/;

async function sit(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Sit down", exact: true }).click();
  await expect(page.getByRole("button", { name: "Stand up", exact: true })).toBeVisible();
  await expect(page.getByTestId("your-status")).toContainText("Pick a card");
}

test("practice: sit, play a card, see the settled hand", async ({ page }) => {
  await page.goto("#/practice");
  await expect(page.locator("canvas.comic")).toBeVisible();
  await expect(page.getByText("Practice table. Nothing here touches the chain.")).toBeVisible();
  await page.screenshot({ path: `${shotDir(SHOTS_BASE)}/practice-idle.png` });

  await sit(page);
  await page.screenshot({ path: `${shotDir(SHOTS_BASE)}/practice-seated.png` });

  // Iron opens the target picker; holster it, then play Table with key 3.
  await page.getByRole("button", { name: /^Iron, key 2/ }).click();
  await expect(page.getByRole("group", { name: "Iron at" })).toBeVisible();
  await page.screenshot({ path: `${shotDir(SHOTS_BASE)}/practice-picker.png` });
  await page.getByRole("button", { name: "Holster" }).click();
  await page.keyboard.press("3");
  await expect(page.getByTestId("your-status")).toContainText(/Your card is (shown|face down)|turning over/);

  // The minute settles on the next ledger and the reveal plays.
  await expect(page.locator(".recent summary")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("narration")).toContainText(MAIN_LINE, { timeout: 5_000 });
  // Minute prefix and the who-shot-whom line (SPEC 4.4 lines stay).
  await expect(page.getByTestId("narration")).toContainText(/^Minute \d+\. /);
  await expect(page.getByTestId("narration")).toContainText(/fired at|ducked\.|Nobody fired\. Nobody ducked\./);
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${shotDir(SHOTS_BASE)}/practice-reveal.png` });
  await page.waitForTimeout(3000);
  // Next minute: cards open again.
  await expect(page.getByRole("button", { name: /^Air, key 1$/ })).toBeEnabled({ timeout: 15_000 });
});

test("map: nine chips and the slip", async ({ page }) => {
  await page.goto("?stub=1#/");
  const chips = page.locator(".town-chip");
  await expect(chips).toHaveCount(9);
  await expect(page.locator(".survey")).toBeVisible();
  await expect(page.getByText("Nine rooms along the Glass River.")).toBeVisible();
  for (const name of ["Map", "Dust Gazette", "skill.md", "Claim an agent", "Practice"]) {
    await expect(page.getByRole("navigation", { name: "Site" }).getByRole("link", { name, exact: true })).toBeVisible();
  }
  await page.screenshot({ path: `${shotDir(SHOTS_BASE)}/map.png` });
  await page.locator('.town-chip[data-room="denvar"]').click();
  const slip = page.getByRole("dialog", { name: "Denvar slip" });
  await expect(slip).toContainText("Three chairs. You take one. The house sits the other two until somebody else walks in.");
  await expect(slip.getByRole("button", { name: "Walk in" })).toBeVisible();
  await page.screenshot({ path: `${shotDir(SHOTS_BASE)}/map-slip.png` });
  await slip.getByRole("button", { name: "Watch the minute" }).click();
  await expect(page).toHaveURL(/#\/room\/denvar$/);
  await expect(page.getByRole("heading", { name: "Denvar" })).toBeVisible();
  await expect(page.locator(".roster")).toContainText("House");
  await page.screenshot({ path: `${shotDir(SHOTS_BASE)}/room-watch.png` });

  await page.goto("?stub=1#/gazette");
  await expect(page.getByRole("heading", { name: "The Dust Gazette" })).toBeVisible();
  await page.screenshot({ path: `${shotDir(SHOTS_BASE)}/gazette.png` });
});

test("mobile 375px: chips and cards stay clickable", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 740 });
  await page.goto("?stub=1#/");
  await expect(page.locator(".town-chip")).toHaveCount(9);
  await page.locator('.town-chip[data-room="tucsan"]').click();
  await expect(page.getByRole("dialog", { name: "Tucsan slip" })).toBeVisible();
  await page.screenshot({ path: `${shotDir(SHOTS_BASE)}/mobile-map.png` });

  await page.goto("#/practice");
  await sit(page);
  const air = page.getByRole("button", { name: /^Air, key 1$/ });
  await air.scrollIntoViewIfNeeded();
  await expect(air).toBeInViewport();
  await page.screenshot({ path: `${shotDir(SHOTS_BASE)}/mobile-saloon.png`, fullPage: true });
  await air.click();
  await expect(page.getByTestId("your-status")).toContainText(/Your card is (shown|face down)|turning over/);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("doors, wallet link, drawer, claim (stub client)", async ({ page }) => {
  await page.goto("?stub=1#/room/billen");
  await expect(page.getByText("The house is rehearsing. Nothing here touches the chain.")).toBeVisible();
  await page.screenshot({ path: `${shotDir(SHOTS_BASE)}/rehearsal.png` });
  await page.getByRole("button", { name: "Sit down", exact: true }).click();
  const doors = page.getByRole("dialog", { name: "Three doors into the saloon" });
  await expect(doors.getByRole("button", { name: /Walk in as a guest/ })).toBeVisible();
  await page.screenshot({ path: `${shotDir(SHOTS_BASE)}/doors.png` });
  await doors.getByRole("button", { name: /Connect a Stellar wallet/ }).click();
  const sign = doors.getByRole("button", { name: "Sign the link (one signature)" });
  await expect(sign).toBeEnabled();
  await page.screenshot({ path: `${shotDir(SHOTS_BASE)}/doors-wallet.png` });
  await sign.click();
  // The doors link first, then sit, then close. The toast stays after the doors close.
  await expect(page.getByRole("status").getByText("Linked. Your next win pays.")).toBeVisible();
  await expect(doors).toBeHidden();
  await expect(page.getByRole("button", { name: "Stand up", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Your chair and wallet" }).click();
  await expect(page.getByRole("dialog", { name: "Your chair" })).toContainText("Linked");
  await page.screenshot({ path: `${shotDir(SHOTS_BASE)}/drawer.png` });
  await page.keyboard.press("Escape");

  await page.goto(`?stub=1#/claim?agent=G${"A".repeat(55)}`);
  await expect(page.getByRole("heading", { name: "Claim an agent" })).toBeVisible();
  await page.screenshot({ path: `${shotDir(SHOTS_BASE)}/claim.png` });
});

test("the receipt gets its tx link when the hash comes after the result (stub chain)", async ({ page }) => {
  // Another client settled: the hash comes from the settled events 6 s after the result.
  await page.goto("?stub=1&latetx=6000&housetable=1#/room/amarilla");
  await page.getByRole("button", { name: "Sit down", exact: true }).click();
  const doors = page.getByRole("dialog", { name: "Three doors into the saloon" });
  await doors.getByRole("button", { name: /Connect a Stellar wallet/ }).click();
  await doors.getByRole("button", { name: "Sign the link (one signature)" }).click();
  await expect(doors).toBeHidden();
  await page.getByRole("button", { name: /^Air, key 1$/ }).click();
  const receipt = page.getByTestId("receipt");
  await expect(receipt).toContainText("+1 XLM", { timeout: 30_000 });
  await expect(receipt.getByRole("link", { name: /tx/ })).toHaveCount(0);
  await expect(receipt.getByRole("link", { name: /tx/ })).toBeVisible({ timeout: 10_000 });
});

test("roster separators, card labels, status while a card is in flight (stub chain)", async ({ page }) => {
  await page.goto("?stub=1#/room/cheyen");
  await expect(page.getByText("The house is rehearsing. Nothing here touches the chain.")).toBeVisible();
  // Spectators get no key and no identity in the header.
  await expect(page.getByRole("button", { name: "Your chair and wallet" })).toContainText("Not seated");
  // Disabled cards never carry the Sit down name.
  await expect(page.getByRole("button", { name: /^Air, key 1\. Take a seat to play\.$/ })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Sit down", exact: true })).toHaveCount(1);
  const row = await page.locator(".roster li").first().textContent();
  expect(row).toMatch(/^Cal · House · 1 bullet · \w+/);

  // The drawer offers a wallet link before the player has a chair.
  await page.getByRole("button", { name: "Your chair and wallet" }).click();
  await expect(page.getByRole("dialog", { name: "Your chair" }).getByRole("button", { name: "Link a wallet" })).toBeVisible();
  await page.screenshot({ path: `${shotDir(SHOTS_BASE)}/drawer-no-chair.png` });
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Sit down", exact: true }).click();
  await page.getByRole("dialog", { name: "Three doors into the saloon" }).getByRole("button", { name: /Walk in as a guest/ }).click();
  await expect(page.getByTestId("your-status")).toContainText("Pick a card");
  await expect(page.locator(".roster")).not.toContainText("rehearsing");
  await expect(page.getByTestId("narration")).not.toContainText("The house deals");
  await expect(page.locator(".roster li").first()).toContainText(/ · Player · .* · (unclaimed|unpaid)$/);

  // Record every status text from the click on.
  await page.evaluate(() => {
    const el = document.querySelector('[data-testid="your-status"]')!;
    const w = window as unknown as { seen: string[] };
    w.seen = [];
    new MutationObserver(() => w.seen.push(el.textContent ?? "")).observe(el, { childList: true, characterData: true, subtree: true });
  });
  await page.getByRole("button", { name: /^Table, key 3$/ }).click();
  await expect(page.getByRole("button", { name: /^Air, key 1/ })).toBeDisabled();
  await expect(page.getByTestId("your-status")).toContainText(/Your card is (shown|face down)/);
  const seen = await page.evaluate(() => (window as unknown as { seen: string[] }).seen);
  expect(seen[0]).toBe("Sending your card...");
  expect(seen.slice(1).some((t) => t.includes("Pick a card"))).toBe(false);
  await page.screenshot({ path: `${shotDir(SHOTS_BASE)}/stub-card-down.png` });
});

test("gazette closes back to the room it opened from", async ({ page }) => {
  await page.goto("?stub=1#/room/denvar");
  await expect(page.getByRole("heading", { name: "Denvar" })).toBeVisible();
  await page.getByRole("navigation", { name: "Site" }).getByRole("link", { name: "Dust Gazette" }).click();
  const gz = page.getByRole("dialog", { name: "The Dust Gazette" });
  await expect(gz).toContainText("Wins count sole survivors. Earned counts testnet XLM paid.");
  await expect(gz.locator(".gz-board")).toBeVisible();
  await page.screenshot({ path: `${shotDir(SHOTS_BASE)}/gazette-over-room.png` });
  await gz.getByRole("button", { name: "Close the gazette" }).click();
  await expect(page).toHaveURL(/#\/room\/denvar$/);
  await expect(page.getByRole("heading", { name: "Denvar" })).toBeVisible();
});

test("mobile 375x740 map: compact status, 32 px chips, no overlap", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 740 });
  await page.goto("?stub=1#/");
  const chips = page.locator(".town-chip");
  await expect(chips).toHaveCount(9);
  await expect(page.locator('.town-chip[data-room="denvar"] .town-status')).toBeVisible();
  const boxes = await chips.evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }));
  for (const b of boxes) expect(b.h).toBeGreaterThanOrEqual(32);
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
      expect(overlap, `chips ${i} and ${j} overlap`).toBe(false);
    }
  const stageH = await page.locator(".map-stage").evaluate((e) => e.getBoundingClientRect().height);
  expect(stageH).toBeGreaterThan(300);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await page.screenshot({ path: `${shotDir(SHOTS_BASE)}/mobile-map-375.png` });
  await page.locator('.town-chip[data-room="tucsan"]').click();
  await expect(page.getByRole("dialog", { name: "Tucsan slip" })).toBeVisible();
  await page.screenshot({ path: `${shotDir(SHOTS_BASE)}/mobile-map-slip-375.png` });

  await page.goto("?stub=1#/room/billen");
  await expect(page.locator(".roster li").first()).toContainText("Cal · House");
  await page.screenshot({ path: `${shotDir(SHOTS_BASE)}/mobile-room-375.png`, fullPage: true });
});

test("chain room before the first read: reading state, no Sit button, no rehearsal", async ({ page }) => {
  // Hold every RPC call so the first chain view never arrives.
  await page.route("https://soroban-testnet.stellar.org/**", () => undefined);
  await page.route("https://soroban-testnet.stellar.org", () => undefined);
  await page.goto("#/room/laramy");
  await expect(page.getByTestId("narration")).toHaveText("Reading the table...");
  await expect(page.getByRole("button", { name: "Sit down", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Stand up", exact: true })).toHaveCount(0);
  await expect(page.getByText("The house is rehearsing. Nothing here touches the chain.")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Your chair and wallet" })).toContainText("Not seated");
  await page.screenshot({ path: `${shotDir(SHOTS_BASE)}/room-reading.png` });

  // Opening the doors is the intent: the key is made then, and the Friendbot wait counts seconds.
  await page.getByRole("button", { name: "Your chair and wallet" }).click();
  await page.getByRole("dialog", { name: "Your chair" }).getByRole("button", { name: "Link a wallet" }).click();
  await expect(page.getByTestId("friendbot-wait")).toContainText(/Friendbot is funding your key: \d+ s \(usually 10 to 30 s\)\./);
  await expect(page.getByTestId("friendbot-wait")).toContainText(/: [1-9]\d* s/, { timeout: 4_000 });
  await page.screenshot({ path: `${shotDir(SHOTS_BASE)}/doors-friendbot.png` });
  await page.getByRole("button", { name: "Close" }).click();
  await page.setViewportSize({ width: 375, height: 740 });
  await page.screenshot({ path: `${shotDir(SHOTS_BASE)}/room-reading-375.png`, fullPage: true });
});

test("navbar: How it works from the map and from a room; the nine-chip map still works", async ({ page, browserName }) => {
  const R2 = shotDir("scratch/round2/pages");
  await page.goto("?stub=1#/");
  const nav = page.getByRole("navigation", { name: "Main" });
  for (const name of ["Map", "How it works", "Gazette", "Practice"]) await expect(nav.getByRole("link", { name, exact: true })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Map", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.locator(".town-chip")).toHaveCount(9);
  await page.screenshot({ path: `${R2}/nav-map-1280.png` });

  // The slip carries the stake hint and a How it works link.
  await page.locator('.town-chip[data-room="billen"]').click();
  const slip = page.getByRole("dialog", { name: "Billen slip" });
  await expect(slip).toContainText("Free to sit. The last one standing wins 1 XLM.");
  await expect(slip.getByRole("link", { name: "How it works" })).toBeVisible();
  await page.screenshot({ path: `${R2}/map-slip-1280.png` });
  await page.keyboard.press("Escape");

  // Keyboard: Tab reaches the navbar link and Enter follows it.
  // Safari/WebKit skips links on plain Tab by default; Option+Tab is the platform key for links.
  const tab = browserName === "webkit" ? "Alt+Tab" : "Tab";
  await page.locator(".brand").focus();
  await page.keyboard.press(tab);
  await page.keyboard.press(tab);
  await expect(nav.getByRole("link", { name: "How it works" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#\/how$/);
  await expect(page.getByRole("heading", { name: "How it works", level: 1 })).toBeVisible();
  await expect(nav.getByRole("link", { name: "How it works" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { name: "What you play for" })).toBeVisible();
  await expect(page.locator(".hw-cards .hw-card")).toHaveCount(3);
  await expect(page.locator(".hw-ex")).toHaveCount(5);
  await expect(page.locator(".hw-ex").first().locator(".hw-seat")).toHaveCount(3);
  await expect(page.getByRole("link", { name: "skill.md for agents" })).toHaveAttribute("href", "/third-chair/skill.md");
  await expect(page.getByRole("link", { name: "Claim an agent" }).first()).toHaveAttribute("href", "#/claim");
  await page.screenshot({ path: `${R2}/how-1280.png` });
  await page.screenshot({ path: `${R2}/how-1280-full.png`, fullPage: true });

  // From a room.
  await page.goto("?stub=1#/room/denvar");
  await expect(page.getByRole("heading", { name: "Denvar" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "How it works" })).toBeVisible();
  await page.screenshot({ path: `${R2}/nav-room-1280.png` });
  await nav.getByRole("link", { name: "How it works" }).click();
  await expect(page).toHaveURL(/#\/how$/);
  await expect(page.getByRole("heading", { name: "How it works", level: 1 })).toBeVisible();

  // Back to the map through the brand: nine chips, slip, walk to a room.
  await page.getByRole("link", { name: /Third Chair/ }).click();
  await expect(page.locator(".town-chip")).toHaveCount(9);
  await page.locator('.town-chip[data-room="tucsan"]').click();
  await page.getByRole("dialog", { name: "Tucsan slip" }).getByRole("button", { name: "Watch the minute" }).click();
  await expect(page).toHaveURL(/#\/room\/tucsan$/);
  await expect(page.getByRole("heading", { name: "Tucsan" })).toBeVisible();

  // The navbar on the other routes.
  await page.goto("?stub=1#/practice");
  await expect(nav.getByRole("link", { name: "Practice" })).toHaveAttribute("aria-current", "page");
  await page.screenshot({ path: `${R2}/nav-practice-1280.png` });
  await page.goto("?stub=1#/gazette");
  await expect(page.getByRole("heading", { name: "The Dust Gazette" })).toBeVisible();
  await page.screenshot({ path: `${R2}/nav-gazette-1280.png` });
  await page.goto(`?stub=1#/claim?agent=G${"A".repeat(55)}`);
  await expect(page.getByRole("heading", { name: "Claim an agent" })).toBeVisible();
  await page.screenshot({ path: `${R2}/nav-claim-1280.png` });
});

test("navbar and How it works at 375x740", async ({ page }) => {
  const R2 = shotDir("scratch/round2/pages");
  await page.setViewportSize({ width: 375, height: 740 });
  const nav = page.getByRole("navigation", { name: "Main" });
  const noOverflow = async (): Promise<void> => {
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  };
  for (const [hash, shot] of [["#/", "map"], ["#/room/billen", "room"], ["#/practice", "practice"], ["#/claim", "claim"], ["#/how", "how"]] as const) {
    await page.goto(`?stub=1${hash}`);
    for (const name of ["Map", "How it works", "Gazette", "Practice"]) await expect(nav.getByRole("link", { name, exact: true })).toBeInViewport();
    await noOverflow();
    await page.screenshot({ path: `${R2}/nav-${shot}-375.png` });
  }
  await page.screenshot({ path: `${R2}/how-375-full.png`, fullPage: true });
  // The navbar sits above the stage, never over it.
  await page.goto("?stub=1#/room/billen");
  const navBox = await nav.boundingBox();
  const stageBox = await page.locator(".stage").boundingBox();
  expect(navBox && stageBox && navBox.y + navBox.height <= stageBox.y).toBe(true);
  // Phone map: room list with live status under the painting.
  await page.goto("?stub=1#/");
  await expect(page.locator(".room-row")).toHaveCount(9);
  await page.locator('.room-row[data-room="cheyen"]').click();
  await expect(page.getByRole("dialog", { name: "Cheyen slip" })).toBeVisible();
  await page.screenshot({ path: `${R2}/map-list-slip-375.png` });
  await page.goto("?stub=1#/gazette");
  await expect(page.getByRole("heading", { name: "The Dust Gazette" })).toBeVisible();
  await page.screenshot({ path: `${R2}/nav-gazette-375.png` });
});

test("sound remembered on: the first tap or click starts audio", async ({ page, isMobile }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem("standoff.sound", "on");
    } catch {
      /* ignore */
    }
    const w = window as unknown as { __ctxs: AudioContext[]; AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
    w.__ctxs = [];
    const Base = w.AudioContext ?? w.webkitAudioContext;
    if (!Base) return;
    class Probe extends Base {
      constructor(o?: AudioContextOptions) {
        super(o);
        w.__ctxs.push(this);
      }
    }
    w.AudioContext = Probe;
    if (w.webkitAudioContext) w.webkitAudioContext = Probe;
  });
  await page.goto("?stub=1#/how");
  await expect(page.getByRole("heading", { name: "How it works", level: 1 })).toBeVisible();
  const heading = page.getByRole("heading", { name: "How it works", level: 1 });
  if (isMobile) await heading.tap();
  else await heading.click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __ctxs: AudioContext[] }).__ctxs.map((c) => c.state).join(",")), { timeout: 5_000 })
    .toMatch(/running/);
});
