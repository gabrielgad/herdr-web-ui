import type { HerdrPane, SessionSnapshot } from "../shared/protocol.ts";

/** Panes herdr calls idle or done that may still wait on a prompt: pi (its own dialogs) and Claude (a question). */
export function mayBeAsking(pane: Pick<HerdrPane, "agent" | "agent_status">): boolean {
  return (pane.agent === "pi" || pane.agent === "claude") && (pane.agent_status === "idle" || pane.agent_status === "done");
}

/** The snapshot with every pane `asking` names read as blocked, in `panes` and in `agents`. */
export function withBlockedPanes(snapshot: SessionSnapshot, asking: ReadonlySet<string>): SessionSnapshot {
  if (asking.size === 0) return snapshot;
  return {
    ...snapshot,
    panes: snapshot.panes.map((pane) => asking.has(pane.pane_id) && mayBeAsking(pane) ? { ...pane, agent_status: "blocked" } : pane),
    agents: snapshot.agents.map((agent) => asking.has(agent.pane_id) && (agent.agent_status === "idle" || agent.agent_status === "done") ? { ...agent, agent_status: "blocked" } : agent),
  };
}
