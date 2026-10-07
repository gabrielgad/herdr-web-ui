import { afterAll, beforeAll, expect, it } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createServer } from "./index.ts";
import { herdrRpc, sessionSnapshot, workspaceClose, workspaceCreate } from "./herdr/client.ts";
import type { SessionSnapshot } from "../shared/protocol.ts";

// A pi that herdr reports idle, with an extension's picker on its screen, reads blocked to clients.
const root = mkdtempSync(join(tmpdir(), "herdr-web-ui-asking-contract-"));
const workspaces: string[] = [];
let server: ReturnType<typeof createServer>;
let seq = Date.now() * 1000;

const rule = "─".repeat(40);
const picker = ` Pick a session\n\n > Resume A\n   Resume B\n\n up/down move · enter select · esc cancel\n${rule}\nno git      no-nvim\n`;
const idle = `${rule}\n ❯ \n${rule}\nno git      no-nvim\n`;

function fakePi(name: string, screen: string): string {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "screen.txt"), screen);
  const bin = join(dir, "pi");
  writeFileSync(bin, `#!/bin/sh\nclear\ncat '${join(dir, "screen.txt")}'\nsleep 600\n`);
  chmodSync(bin, 0o755);
  return bin;
}

async function piPane(name: string, screen: string): Promise<string> {
  const created = await workspaceCreate({ cwd: root, label: `herdr-web-ui-test-asking-${name}`});
  workspaces.push(created.workspace.workspace_id);
  const target = created.root_pane.pane_id;
  await herdrRpc("pane.send_text", { pane_id: target, text: `${fakePi(name, screen)}\n` });
  for (const deadline = Date.now() + 10_000;;) {
    const pane = (await sessionSnapshot()).panes.find((candidate) => candidate.pane_id === target);
    if (pane?.agent === "pi") break;
    if (Date.now() > deadline) throw new Error("test pi did not start");
    await Bun.sleep(50);
  }
  await herdrRpc("pane.report_agent", { pane_id: target, source: "herdr:pi", agent: "pi", state: "idle", seq: ++seq });
  return target;
}

beforeAll(() => {
  server = createServer({ port: 0, hostname: "127.0.0.1", token: "", stateDir: join(root, "push"), machines: false });
});

afterAll(async () => {
  server?.stop();
  for (const workspaceId of workspaces) await workspaceClose(workspaceId);
  rmSync(root, { recursive: true, force: true });
});

const statusOf = async (paneId: string): Promise<{ pane: string | undefined; agent: string | undefined }> => {
  const response = await fetch(`http://127.0.0.1:${server.port}/api/session`);
  expect(response.status).toBe(200);
  const { snapshot } = await response.json() as { snapshot: SessionSnapshot };
  return {
    pane: snapshot.panes.find((pane) => pane.pane_id === paneId)?.agent_status,
    agent: snapshot.agents.find((agent) => agent.pane_id === paneId)?.agent_status,
  };
};

it("reads a pi pane with a picker waiting as blocked, and one with nothing waiting as not", async () => {
  const asking = await piPane("asking", picker);
  const quiet = await piPane("quiet", idle);
  for (const deadline = Date.now() + 10_000;;) {
    const got = await statusOf(asking);
    if (got.pane === "blocked") { expect(got.agent).toBe("blocked"); break; }
    if (Date.now() > deadline) throw new Error(`asking pane read ${got.pane}`);
    await Bun.sleep(200);
  }
  expect((await statusOf(quiet)).pane).not.toBe("blocked");
}, 40_000);
