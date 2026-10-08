import { describe, expect, it } from "bun:test";
import type { SessionSnapshot } from "../shared/protocol.ts";
import { rollUp, withViewedPanes } from "./viewed-panes.ts";

const snapshot = (statuses: Record<string, string>): SessionSnapshot => ({
  tabs: [],
  workspaces: [],
  panes: Object.entries(statuses).map(([pane_id, agent_status]) => ({ pane_id, agent_status })),
  agents: Object.entries(statuses).map(([pane_id, agent_status]) => ({ pane_id, agent_status })),
} as unknown as SessionSnapshot);

describe("withViewedPanes", () => {
  it("reads a done pane as idle once it is viewed, in panes and agents", () => {
    const shown = withViewedPanes(snapshot({ a: "done", b: "done", c: "working" }), (id) => id === "a");
    expect(shown.panes.map((pane) => pane.agent_status)).toEqual(["idle", "done", "working"]);
    expect(shown.agents.map((agent) => agent.agent_status)).toEqual(["idle", "done", "working"]);
  });

  it("leaves every other status of a viewed pane alone", () => {
    const base = snapshot({ a: "working", b: "blocked", c: "idle", d: "unknown" });
    expect(withViewedPanes(base, () => true)).toBe(base);
  });
});

const layout = (): SessionSnapshot => ({
  workspaces: [{ workspace_id: "w1", agent_status: "done" }, { workspace_id: "w2", agent_status: "done" }],
  tabs: [
    { tab_id: "t1", workspace_id: "w1", agent_status: "done" },
    { tab_id: "t2", workspace_id: "w1", agent_status: "working" },
    { tab_id: "t3", workspace_id: "w2", agent_status: "done" },
  ],
  panes: [
    { pane_id: "a", tab_id: "t1", workspace_id: "w1", agent_status: "idle" },
    { pane_id: "b", tab_id: "t1", workspace_id: "w1", agent_status: "working" },
    { pane_id: "c", tab_id: "t2", workspace_id: "w1", agent_status: "working" },
    { pane_id: "d", tab_id: "t3", workspace_id: "w2", agent_status: "idle" },
  ],
  agents: [],
} as unknown as SessionSnapshot);

describe("rollUp", () => {
  it("keeps a tab and workspace working while another pane works", () => {
    const shown = rollUp(layout(), ["a"]);
    expect(shown.tabs.find((tab) => tab.tab_id === "t1")?.agent_status).toBe("working");
    expect(shown.workspaces.find((workspace) => workspace.workspace_id === "w1")?.agent_status).toBe("working");
  });

  it("reads idle when only seen panes remain", () => {
    const shown = rollUp(layout(), ["d"]);
    expect(shown.tabs.find((tab) => tab.tab_id === "t3")?.agent_status).toBe("idle");
    expect(shown.workspaces.find((workspace) => workspace.workspace_id === "w2")?.agent_status).toBe("idle");
  });

  it("ranks blocked over working over done over idle", () => {
    const base = layout();
    const mixed = { ...base, panes: base.panes.map((pane) => pane.pane_id === "d" ? { ...pane, agent_status: "done" } : pane.pane_id === "a" ? { ...pane, agent_status: "blocked" } : pane) } as SessionSnapshot;
    expect(rollUp(mixed, ["a"]).tabs.find((tab) => tab.tab_id === "t1")?.agent_status).toBe("blocked");
    expect(rollUp(mixed, ["d"]).tabs.find((tab) => tab.tab_id === "t3")?.agent_status).toBe("done");
  });

  it("leaves untouched tabs and workspaces as herdr reported them", () => {
    const shown = rollUp(layout(), ["d"]);
    expect(shown.tabs.filter((tab) => tab.tab_id !== "t3")).toEqual(layout().tabs.filter((tab) => tab.tab_id !== "t3"));
    expect(shown.workspaces[0]).toEqual(layout().workspaces[0]);
  });

  it("returns the snapshot itself when no listed pane exists", () => {
    const base = layout();
    expect(rollUp(base, [])).toBe(base);
    expect(rollUp(base, ["zz"])).toBe(base);
  });
});

describe("withViewedPanes roll-up", () => {
  it("rolls the tab and workspace of a seen pane up to idle", () => {
    const base = layout();
    const done = { ...base, panes: base.panes.map((pane) => pane.pane_id === "d" ? { ...pane, agent_status: "done" } : pane) } as SessionSnapshot;
    const shown = withViewedPanes(done, (id) => id === "d");
    expect(shown.tabs.find((tab) => tab.tab_id === "t3")?.agent_status).toBe("idle");
    expect(shown.workspaces.find((workspace) => workspace.workspace_id === "w2")?.agent_status).toBe("idle");
    expect(shown.tabs.find((tab) => tab.tab_id === "t2")?.agent_status).toBe("working");
  });
});
