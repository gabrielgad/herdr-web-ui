import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Browser, CDPSession, Locator } from "playwright-core";
import { sessionSnapshot, workspaceClose, workspaceCreate } from "../server/herdr/client.ts";

async function center(target: Locator): Promise<{ x: number; y: number }> {
  const box = await target.boundingBox();
  assert.ok(box, "the target is on the screen");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

const touch = (cdp: CDPSession, type: "touchStart" | "touchMove" | "touchEnd", at?: { x: number; y: number }) =>
  cdp.send("Input.dispatchTouchEvent", { type, touchPoints: at ? [at] : [] });

/** A touch screen drags a workspace row by its grip, and a press and hold opens the row's menu. */
export async function checkSidebarTouch(browser: Browser, origin: string): Promise<void> {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "herdr-web-ui-sidebar-touch-")));
  const owned: string[] = [];
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: "en-US" });
  try {
    const created = [];
    for (const name of ["a", "b", "c"]) {
      const workspace = await workspaceCreate({ cwd: root, label: `herdr-web-ui-test-touch-${name}` });
      owned.push(workspace.workspace.workspace_id);
      created.push(workspace);
    }
    const [a, b, c] = owned as [string, string, string];
    const mine = async (): Promise<string[]> => (await sessionSnapshot()).workspaces.map((w) => w.workspace_id).filter((id) => owned.includes(id));
    assert.deepEqual(await mine(), [a, b, c]);

    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${origin}/?pane=${encodeURIComponent(created[0]!.root_pane.pane_id)}`);
    await page.locator('button[aria-controls="workspace-drawer"]').click();
    const row = (id: string) => page.locator(`.workspace-group[data-workspace="${id}"]`);
    const header = (id: string) => row(id).locator(":scope > .workspace-header");
    await row(c).waitFor();
    // the drawer slides in: rows are measured once it rests
    await page.waitForTimeout(600);
    for (const id of owned) {
      assert.equal(await header(id).locator(".sidebar-drag-handle").count(), 1, "a row has a grip on a touch screen");
      assert.equal(await header(id).locator(".workspace-select").getAttribute("draggable"), "false", "the browser's own drag is off, the grip moves the row");
    }
    const cdp = await context.newCDPSession(page);

    // a press and hold on a row opens its menu, and the tap that lifts does not also open the row
    const before = await page.locator('.workspace-group [aria-current="true"]').count();
    await touch(cdp, "touchStart", await center(header(b).locator(".workspace-select")));
    await page.waitForTimeout(700);
    await touch(cdp, "touchEnd");
    const sheet = page.getByRole("dialog", { name: "herdr-web-ui-test-touch-b", exact: true });
    await sheet.waitFor();
    assert.ok((await sheet.locator(".row-sheet-item").allTextContents()).includes("Rename workspace"), "the held row's menu");
    await page.waitForTimeout(400);
    await sheet.getByRole("button", { name: "Cancel", exact: true }).tap();
    await sheet.waitFor({ state: "detached" });
    assert.equal(await page.locator('.workspace-group [aria-current="true"]').count(), before, "the hold did not open the row");

    // a finger that moves is a scroll, not a hold
    const start = await center(header(b).locator(".workspace-select"));
    await touch(cdp, "touchStart", start);
    await touch(cdp, "touchMove", { x: start.x, y: start.y + 40 });
    await page.waitForTimeout(700);
    await touch(cdp, "touchEnd");
    assert.equal(await page.getByRole("dialog", { name: "herdr-web-ui-test-touch-b", exact: true }).count(), 0, "a moving finger holds nothing");

    // the grip drags a row onto another: forward two places, then back to the front
    const drag = async (from: string, onto: string): Promise<void> => {
      const grip = await center(header(from).locator(".sidebar-drag-handle"));
      const target = await center(header(onto));
      await touch(cdp, "touchStart", grip);
      for (const step of [0.25, 0.5, 0.75, 1]) await touch(cdp, "touchMove", { x: grip.x + (target.x - grip.x) * step, y: grip.y + (target.y - grip.y) * step });
      // a copy of the row follows the finger, and it does not take the drop
      assert.equal(await page.locator("body > [data-drag-ghost]").count(), 1, "a copy of the row follows the finger");
      const ghost = await page.locator("[data-drag-ghost]").boundingBox();
      assert.ok(ghost && Math.abs(ghost.y + ghost.height / 2 - target.y) < ghost.height, "the copy is under the finger");
      await touch(cdp, "touchEnd");
      await page.locator("[data-drag-ghost]").waitFor({ state: "detached" });
    };
    await drag(a, c);
    const until = async (want: string[], what: string): Promise<void> => {
      const deadline = Date.now() + 8_000;
      while (Date.now() < deadline) {
        if ((await mine()).join() === want.join()) return;
        await page.waitForTimeout(100);
      }
      assert.deepEqual(await mine(), want, what);
    };
    await until([b, c, a], "dragging a's grip onto c puts a after c");
    assert.deepEqual(await page.locator(owned.map((id) => `.workspace-group[data-workspace="${id}"]`).join(", ")).evaluateAll((rows) => rows.map((r) => (r as HTMLElement).dataset["workspace"])), [b, c, a], "the roster shows the new order");
    await drag(a, b);
    await until([a, b, c], "dragging a's grip onto b puts a before b");
    assert.deepEqual(errors, []);
    console.log("PASS a touch screen drags a workspace row by its grip and opens its menu on a press and hold");
  } finally {
    await context.close();
    for (const id of owned) await workspaceClose(id).catch(() => undefined);
    rmSync(root, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  await import("./test-herdr.ts");
  const { chromium } = await import("playwright-core");
  const { createServer } = await import("../server/index.ts");
  const { UsageService } = await import("../server/usage.ts");
  const state = mkdtempSync(join(tmpdir(), "herdr-web-ui-sidebar-touch-state-"));
  const server = createServer({ port: 0, hostname: "127.0.0.1", token: "", stateDir: state, usage: new UsageService(undefined, []) });
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? "/opt/google/chrome/chrome", headless: true, args: ["--no-sandbox"] });
  try {
    await checkSidebarTouch(browser, `http://127.0.0.1:${server.port}`);
  } finally {
    await browser.close();
    server.stop();
    rmSync(state, { recursive: true, force: true });
  }
}
