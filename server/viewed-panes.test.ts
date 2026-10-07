import { describe, expect, it } from "bun:test";
import type { SessionSnapshot } from "../shared/protocol.ts";
import { withViewedPanes } from "./viewed-panes.ts";

const snapshot = (statuses: Record<string, string>): SessionSnapshot => ({
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
