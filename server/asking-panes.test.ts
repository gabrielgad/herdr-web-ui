import { describe, expect, test } from "bun:test";

import type { HerdrPane, SessionSnapshot } from "../shared/protocol.ts";
import { mayBeAsking, withBlockedPanes } from "./asking-panes.ts";

const pane = (pane_id: string, agent: string, agent_status: string) => ({ pane_id, agent, agent_status } as HerdrPane);
const snapshot = (panes: HerdrPane[]) => ({ panes, agents: panes.map((p) => ({ pane_id: p.pane_id, agent: p.agent, agent_status: p.agent_status })) } as unknown as SessionSnapshot);
const status = (s: SessionSnapshot) => s.panes.map((p) => p.agent_status);

describe("a pane waiting on a prompt reads blocked", () => {
  test("only pi and Claude panes herdr calls idle or done can be asking", () => {
    expect(mayBeAsking(pane("a", "pi", "idle"))).toBe(true);
    expect(mayBeAsking(pane("a", "claude", "done"))).toBe(true);
    expect(mayBeAsking(pane("a", "claude", "working"))).toBe(false);
    expect(mayBeAsking(pane("a", "codex", "idle"))).toBe(false);
  });
  test("an asking pane is blocked in panes and in agents; the rest are left alone", () => {
    const before = snapshot([pane("a", "pi", "idle"), pane("b", "claude", "done"), pane("c", "claude", "idle")]);
    const after = withBlockedPanes(before, new Set(["a", "b"]));
    expect(status(after)).toEqual(["blocked", "blocked", "idle"]);
    expect(after.agents.map((agent) => agent.agent_status)).toEqual(["blocked", "blocked", "idle"]);
    expect(status(before)).toEqual(["idle", "done", "idle"]);
  });
  test("a pane that went to work since it was read is not blocked", () => {
    const after = withBlockedPanes(snapshot([pane("a", "pi", "working")]), new Set(["a"]));
    expect(status(after)).toEqual(["working"]);
  });
  test("nothing asking returns the snapshot itself", () => {
    const before = snapshot([pane("a", "pi", "idle")]);
    expect(withBlockedPanes(before, new Set())).toBe(before);
  });
});
