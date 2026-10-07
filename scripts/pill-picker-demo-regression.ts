import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright-core";
import panes from "../site/demo/fixtures/panes.json";
import { buildDemoApp } from "./demo-build.ts";

// The model and the level in the composer's pill open the menu of what the pane's agent offers,
// and a pick is sent as the agent's own command, on the unmodified app over the demo's fixture
// transport (its /api/pane/models answers what the real server reads off claude and pi). All
// files and HTTP traffic stay in this disposable, loopback-only app; no herdr session is opened.
// PILL_VIDEO_DIR records each case as a video there, for the issue or the pull request.
const app = mkdtempSync(join(tmpdir(), "herdr-pill-picker-demo-"));
const videoDir = process.env["PILL_VIDEO_DIR"];
// PILL_SHOT_DIR keeps a screenshot of each menu as it opens
const shotDir = process.env["PILL_SHOT_DIR"];
const shot = (page: Page, name: string) => shotDir ? page.screenshot({ path: join(shotDir, `${name}.png`) }) : Promise.resolve(undefined);

const pill = (page: Page, part: "model" | "reasoning") => page.locator(part === "model" ? ".composer-model" : ".composer-reasoning");
const pause = (page: Page, ms = 2200) => page.waitForTimeout(videoDir ? ms : 0);

/** Opens the demo's pane `id` (by `?pane=`, so a phone's closed drawer is no obstacle) and shows its chat. */
async function openById(page: Page, id: string): Promise<void> {
  await page.locator(".conn-live").waitFor({ state: "attached" });
  await page.goto(`${page.url().split("?")[0]}?pane=${encodeURIComponent(id)}`);
  await page.locator(".conn-live").waitFor({ state: "attached" });
  if (await page.locator(".terminal-stack.is-chat").count() === 0) await page.getByTitle("Chat transcript (⌘⇧J)", { exact: true }).click();
  await page.locator(".terminal-stack.is-chat").waitFor();
  await page.locator(".composer-model").waitFor({ state: "attached" });
}

/** Opens the pane the demo gives this title (by `?pane=`, so a phone's closed drawer is no obstacle) and shows its chat. */
async function openPane(page: Page, title: string): Promise<void> {
  await page.locator(".conn-live").waitFor({ state: "attached" });
  let paneId: string | null = null;
  // the demo's session answers once its fixtures are built: ask until the pane is in it
  for (let attempt = 0; attempt < 20 && !paneId; attempt++) {
    paneId = await page.evaluate(async (wanted) => {
      const snapshot = await (await fetch("/api/session")).json() as { snapshot?: { panes: { pane_id: string; title: string | null }[] } };
      return snapshot.snapshot?.panes.find((pane) => pane.title === wanted)?.pane_id ?? null;
    }, title);
    if (!paneId) await page.waitForTimeout(250);
  }
  assert.ok(paneId, `the demo has a pane titled ${title}`);
  await page.goto(`${page.url().split("?")[0]}?pane=${encodeURIComponent(paneId)}`);
  await page.locator(".conn-live").waitFor({ state: "attached" });
  if (await page.locator(".terminal-stack.is-chat").count() === 0) await page.getByTitle("Chat transcript (⌘⇧J)", { exact: true }).click();
  await page.locator(".terminal-stack.is-chat").waitFor();
  await page.locator(".composer-model").waitFor({ state: "attached" });
}

/** A new workspace running `agent`, opened from the sidebar (a phone's drawer first) once the demo's agent has gone idle: it starts out working. */
async function openNew(page: Page, agent: string): Promise<void> {
  await page.locator(".conn-live").waitFor({ state: "attached" });
  await page.evaluate((kind) => fetch("/api/workspace/create", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cwd: "/home/demo/pill", label: `pill-${kind}`, agent: { kind } }) }), agent);
  const row = page.getByText(`pill-${agent}`, { exact: true }).first();
  await row.waitFor({ state: "attached" });
  if (!await row.isVisible()) await page.locator('[aria-controls="workspace-drawer"]').first().click();
  await row.click();
  if (await page.locator(".terminal-stack.is-chat").count() === 0) await page.getByTitle("Chat transcript (⌘⇧J)", { exact: true }).click();
  await page.locator(".terminal-stack.is-chat").waitFor();
  await page.locator(".composer-model").waitFor({ state: "attached" });
}

const items = (page: Page) => page.locator('[role="menu"] [role="menuitem"], .row-sheet-item');

try {
  await buildDemoApp(app);
  // the demo's fixture transport answers in place of herdr, loaded before the app
  const index = join(app, "index.html");
  writeFileSync(index, readFileSync(index, "utf8").replace(/<script type="module"/, () => '<script src="./demo-transport.js"></script>\n    <script type="module"'));
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const path = new URL(request.url).pathname;
    if (!path.startsWith("/herdr-web-ui/demo/app/")) return new Response("not found", { status: 404 });
    let file = decodeURIComponent(path.slice("/herdr-web-ui/demo/app/".length));
    if (!file || file.endsWith("/")) file += "index.html";
    if (file.split("/").includes("..")) return new Response("bad path", { status: 400 });
    const body = Bun.file(join(app, file));
    return (await body.exists()) ? new Response(body) : new Response("not found", { status: 404 });
  } });
  const url = `http://127.0.0.1:${server.port}/herdr-web-ui/demo/app/`;

  const withPage = async (browser: Browser, width: number, name: string, run: (page: Page) => Promise<void>): Promise<void> => {
    const touch = width <= 480;
    // the checks that only assert (a pill that must stay inert) leave nothing worth watching
    const recorded = videoDir !== undefined && !name.startsWith("check");
    const context = await browser.newContext({
      viewport: { width, height: touch ? 844 : 800 }, hasTouch: touch, isMobile: touch, locale: "en-US",
      ...(recorded ? { recordVideo: { dir: videoDir, size: { width, height: touch ? 844 : 800 } } } : {}),
    });
    let page: Page | undefined;
    try {
      await context.addInitScript(() => localStorage.setItem("herdr-web-ui:settings", JSON.stringify({ language: "en" })));
      page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(url);
      await run(page);
      assert.deepEqual(errors, [], name);
    } finally {
      await context.close();
      // named by the case, so a recording is found without opening them all
      if (recorded && page) await page.video()?.saveAs(join(videoDir, `${name.replace(/\s+/g, "-")}.webm`));
    }
  };

  const browser = await chromium.launch({ executablePath: process.env["CHROME_PATH"] ?? "/opt/google/chrome/chrome", headless: true, slowMo: videoDir ? 1200 : 0, args: ["--no-sandbox"] });
  try {
    for (const width of [390, 1280]) {
      // pi: models listed under their provider, the one it runs marked; a pick sends /model provider/model
      await withPage(browser, width, `pi ${width}px`, async (page) => {
        await openPane(page, "Ship the retry flag");
        assert.equal(await pill(page, "model").getAttribute("data-picker"), "", "the model is a target");
        await pause(page);
        await pill(page, "model").click();
        await items(page).first().waitFor();
        assert.deepEqual(await items(page).allTextContents().then((all) => all.map((text) => text.replace(/\s+/g, " ").trim())).then((all) => all.filter((text) => text !== "Cancel")), ["glm-5.3zai", "glm-5.2zai", "claude-opus-5-5anthropic", "tinylocal"]);
        assert.equal(await page.locator('.row-menu [aria-current="true"], .row-sheet [aria-current="true"]').first().textContent().then((text) => /claude-opus-5-5/.test(text ?? "")), true, "the model it runs is marked");
        await shot(page, `pi-model-${width}`);
        await pause(page, 1200);
        await items(page).filter({ hasText: "glm-5.2" }).first().click();
        await page.waitForFunction(() => /glm-5\.2/i.test(document.querySelector(".composer-model")?.textContent ?? ""));
        await pause(page);
        // the level: pi's own levels, set with /thinking
        await pill(page, "reasoning").click();
        await items(page).first().waitFor();
        assert.deepEqual(await items(page).allTextContents().then((all) => all.map((text) => text.trim()).filter((text) => text !== "Cancel")), ["Off", "Minimal", "Low", "Medium", "High", "Xhigh", "Max"]);
        await shot(page, `pi-effort-${width}`);
        await pause(page, 1200);
        await items(page).filter({ hasText: /^Max$/ }).first().click();
        await page.waitForFunction(() => /max/i.test(document.querySelector(".composer-reasoning")?.textContent ?? ""));
        await pause(page, 1200);
      });
    }
    console.log("PASS pi: the model and the level list what pi offers, and a pick changes the pill");

    const labels = (page: Page) => items(page).allTextContents().then((all) => all.map((text) => text.replace(/\s+/g, " ").trim()).filter((text) => text !== "Cancel"));
    for (const width of [390, 1280]) {
      // Claude Code: its models, then the levels of the model it runs (no ultracode: the /effort card leaves it to the terminal); /model, and /effort answered on its card
      await withPage(browser, width, `claude ${width}px`, async (page) => {
        await openNew(page, "claude");
        await page.locator(".composer-model[data-picker]").waitFor();
        await pause(page);
        await pill(page, "model").click();
        await items(page).first().waitFor();
        assert.deepEqual(await labels(page), ["Fable 5.1", "Opus 5.5", "Sonnet 5.5", "Sonnet 5", "Haiku 4.5"]);
        await shot(page, `claude-model-${width}`);
        await pause(page, 1200);
        await items(page).filter({ hasText: "Sonnet 5.5" }).click();
        await page.waitForFunction(() => /Sonnet 5\.5/.test(document.querySelector(".composer-model")?.textContent ?? ""));
        await pause(page);
        await pill(page, "reasoning").click();
        await items(page).first().waitFor();
        assert.deepEqual(await labels(page), ["Low", "Medium", "High", "Xhigh", "Max"]);
        await shot(page, `claude-effort-${width}`);
        await pause(page, 1200);
        // the pick sends a bare /effort and answers its card (the demo changes the level only that way)
        await items(page).filter({ hasText: "Xhigh" }).click();
        await page.waitForFunction(() => /xhigh/i.test(document.querySelector(".composer-reasoning")?.textContent ?? ""));
        await pause(page, 1200);
        // a model that takes no levels has no level menu: the pick falls back to Claude's own /model card
        await pill(page, "model").click();
        await items(page).filter({ hasText: "Haiku 4.5" }).click();
        await page.waitForFunction(() => /Haiku 4\.5/.test(document.querySelector(".composer-model")?.textContent ?? ""));
        await pill(page, "reasoning").click({ force: true });
        await pause(page, 600);
        assert.equal(await items(page).count(), 0, "a model with no levels opens no level menu");
      });
    }
    console.log("PASS claude: the models and the levels of the model it runs, answered on the /effort card");

    // read-only where there is nothing to offer, and while the agent works
    await withPage(browser, 390, "check read-only", async (page) => {
      await openById(page, panes.api);
      assert.equal(await pill(page, "model").getAttribute("data-picker"), null, "a working agent's pill only shows");
      await openById(page, panes.docs);
      assert.equal(await pill(page, "model").getAttribute("data-picker"), null, "an agent with no reader's pill only shows");
    });
    console.log("PASS the pill only shows while the agent works, and for an agent with nothing to offer");
  } finally {
    await browser.close();
    server.stop(true);
  }
} finally {
  rmSync(app, { recursive: true, force: true });
}
