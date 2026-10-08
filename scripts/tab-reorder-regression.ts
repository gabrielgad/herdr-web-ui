import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Browser, CDPSession, Locator, Page } from "playwright-core";
import { herdrRpc, sessionSnapshot, tabCreate, workspaceClose, workspaceCreate } from "../server/herdr/client.ts";

async function center(target: Locator): Promise<{ x: number; y: number }> {
  const box = await target.boundingBox();
  assert.ok(box, "the target is on the screen");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

const touch = (cdp: CDPSession, type: "touchStart" | "touchMove" | "touchEnd", at?: { x: number; y: number }) =>
  cdp.send("Input.dispatchTouchEvent", { type, touchPoints: at ? [at] : [] });

/** Tabs are dragged by their grip with a mouse or a finger, and moved with Alt+arrows; herdr keeps the order. */
export async function checkTabReorder(browser: Browser, origin: string): Promise<void> {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "herdr-web-ui-tab-reorder-")));
  let workspaceId: string | null = null;
  const desktop = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: "en-US" });
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: "en-US" });
  try {
    const first = await workspaceCreate({ cwd: root, label: "herdr-web-ui-test-tab-reorder" });
    workspaceId = first.workspace.workspace_id;
    await herdrRpc("tab.rename", { tab_id: first.tab.tab_id, label: "one" });
    const second = await tabCreate({ workspaceId, label: "two" });
    const third = await tabCreate({ workspaceId, label: "three" });
    const ids = [first.tab.tab_id, second.tab.tab_id, third.tab.tab_id];
    const inHerdr = async (): Promise<string[]> => (await sessionSnapshot()).tabs.filter((tab) => tab.workspace_id === workspaceId).map((tab) => tab.label);
    const until = async (page: Page, want: string[], what: string): Promise<void> => {
      const deadline = Date.now() + 8_000;
      while (Date.now() < deadline) {
        if ((await inHerdr()).join() === want.join()) return;
        await page.waitForTimeout(100);
      }
      assert.deepEqual(await inHerdr(), want, what);
    };
    assert.deepEqual(await inHerdr(), ["one", "two", "three"]);

    const page = await desktop.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${origin}/?pane=${encodeURIComponent(first.root_pane.pane_id)}`);
    const strip = page.locator(".tab-strip");
    await strip.waitFor();
    const item = (label: string) => strip.locator(".tab-strip-item", { has: page.getByRole("tab", { name: label, exact: true }) });
    const shown = async (): Promise<string[]> => await strip.getByRole("tab").allTextContents();
    assert.deepEqual(await shown(), ["one", "two", "three"]);

    // a mouse drags the open tab's grip onto the last tab: it lands after it
    const grip = await center(item("one").locator(".tab-strip-grip"));
    const onto = await center(item("three"));
    await page.mouse.move(grip.x, grip.y);
    await page.mouse.down();
    for (const step of [0.25, 0.5, 0.75, 1]) await page.mouse.move(grip.x + (onto.x - grip.x) * step, grip.y + (onto.y - grip.y) * step);
    await page.mouse.up();
    await until(page, ["two", "three", "one"], "herdr has the dragged tab last");
    assert.deepEqual(await shown(), ["two", "three", "one"], "the strip follows");

    // Alt+arrow moves the focused tab one place, and keeps it focused
    await strip.getByRole("tab", { name: "one", exact: true }).focus();
    await page.keyboard.press("Alt+ArrowLeft");
    await until(page, ["two", "one", "three"], "Alt+Left moved the tab back one place");
    await page.keyboard.press("Alt+ArrowRight");
    await until(page, ["two", "three", "one"], "Alt+Right moved it forward again");
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("data-tab-id")), ids[0], "the moved tab keeps the focus");

    // a finger drags the grip too
    const phonePage = await phone.newPage();
    phonePage.on("pageerror", (error) => errors.push(error.message));
    await phonePage.goto(`${origin}/?pane=${encodeURIComponent(first.root_pane.pane_id)}`);
    const phoneStrip = phonePage.locator(".tab-strip");
    await phoneStrip.waitFor();
    // the drawer can open first on a phone: it is closed so the strip is under the finger
    if (await phonePage.locator(".scrim").count()) await phonePage.locator(".scrim").click({ position: { x: 380, y: 400 } });
    await phonePage.locator(".scrim").waitFor({ state: "detached" });
    await phonePage.waitForTimeout(600);
    const phoneItem = (label: string) => phoneStrip.locator(".tab-strip-item", { has: phonePage.getByRole("tab", { name: label, exact: true }) });
    assert.equal(await phoneStrip.locator(".tab-strip-grip:visible").count(), 3, "every tab has a grip under a finger");
    const cdp = await phone.newCDPSession(phonePage);
    const from = await center(phoneItem("one").locator(".tab-strip-grip"));
    const to = await center(phoneItem("two"));
    await touch(cdp, "touchStart", from);
    for (const step of [0.25, 0.5, 0.75, 1]) await touch(cdp, "touchMove", { x: from.x + (to.x - from.x) * step, y: from.y + (to.y - from.y) * step });
    await touch(cdp, "touchEnd");
    await until(phonePage, ["one", "two", "three"], "a finger moved the last tab ahead of the first");
    assert.deepEqual(errors, []);
    console.log("PASS tabs are dragged by their grip with a mouse or a finger, and moved with Alt+arrows, in herdr's order");
  } finally {
    await desktop.close();
    await phone.close();
    if (workspaceId) await workspaceClose(workspaceId).catch(() => undefined);
    rmSync(root, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  await import("./test-herdr.ts");
  const { chromium } = await import("playwright-core");
  const { createServer } = await import("../server/index.ts");
  const { UsageService } = await import("../server/usage.ts");
  const state = mkdtempSync(join(tmpdir(), "herdr-web-ui-tab-reorder-state-"));
  const server = createServer({ port: 0, hostname: "127.0.0.1", token: "", stateDir: state, usage: new UsageService(undefined, []) });
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? "/opt/google/chrome/chrome", headless: true, args: ["--no-sandbox"] });
  try {
    await checkTabReorder(browser, `http://127.0.0.1:${server.port}`);
  } finally {
    await browser.close();
    server.stop();
    rmSync(state, { recursive: true, force: true });
  }
}
